# Migrating from Socket.IO to Native WebSockets (jibbr-turbo-repo)

This guide explains how to migrate the real-time layer from **Socket.IO** to **native WebSockets** in jibbr-turbo-repo, while keeping the same event semantics and minimal client API changes.

---

## 1. Why migrate?

- **Simpler stack**: One less protocol (no Engine.IO), smaller bundle on clients.
- **Standard WebSocket**: Easier to debug, works with any WS client; no Socket.IO path (e.g. `/socket.io`) or polling fallback.
- **Control**: You own the message format and reconnection logic.

Trade-offs: You must implement yourself what Socket.IO gives you: message envelope (event type + payload), rooms, auth, and (if scaling) Valkey pub/sub across instances.

---

## 2. Current architecture (summary)

| Layer | Current (Socket.IO) |
|-------|---------------------|
| **socket-service** | `socket.io` server, `@socket.io/redis-adapter` (Valkey-compatible), auth via handshake `auth.token` or `query.token`, rooms: `channelId`, `conversationId`, `user_${userId}` |
| **streams-consumer** | Gets events from Valkey Streams, calls `io.to(room).emit(event, data)` |
| **Clients** (Electron, React Native) | `socket.io-client`: `io(url, { auth: { token } })`, `emit(event, data)`, `on(event, cb)` |

Events are **named** (e.g. `send_message`, `new_message`, `join_channel`). With raw WebSockets you have no built-in “events”; everything is a frame, so you need an **envelope**.

---

## 3. Message envelope (wire format)

Use a single JSON shape for all messages (client → server and server → client):

```ts
// Client -> Server
interface ClientEnvelope {
  type: string;   // e.g. "send_message" | "join_channel" | "ping" | ...
  payload?: Record<string, unknown>;
}

// Server -> Client
interface ServerEnvelope {
  type: string;   // e.g. "new_message" | "authenticated" | "error" | ...
  payload?: Record<string, unknown>;
}
```

- **Client sends**: `JSON.stringify({ type: "send_message", payload: { content, channelId, ... } })`.
- **Server sends**: same idea; client parses and dispatches by `type` to the same listeners you use today.

This keeps your existing event names and payloads; only the transport changes from Socket.IO’s protocol to one JSON line (or one message) per WebSocket frame.

---

## 4. Server migration (socket-service)

### 4.1 Dependencies

- **Remove**: `socket.io`, `@socket.io/redis-adapter`
- **Add**: `ws` (and `@types/ws` if needed)

```bash
cd services/socket-service
npm uninstall socket.io @socket.io/redis-adapter
npm install ws
npm install -D @types/ws
```

### 4.2 Attach WebSocket server to HTTP server

- Use the same `http.Server` you use for Express (or your HTTP entrypoint).
- Attach a `WebSocketServer` from `ws` (e.g. `new WebSocketServer({ server, path: '/ws' })`).
- Optional: pass token via query, e.g. `?token=...`, and validate before accepting (or accept and validate in first message; see below).

### 4.3 Connection lifecycle and auth

- **Option A – Auth in query**: Validate `url.searchParams.get('token')` in the `connection` handler; if invalid, `ws.close()` and return.
- **Option B – Auth in first message**: Accept connection, then require first message to be e.g. `{ type: 'auth', payload: { token } }`; validate and store user on the connection object; ignore other messages until authenticated.

Reuse your existing `authenticateSocket(token)` (JWT verify) from `websocket/utils.js`.

### 4.4 Per-connection state

Replace Socket.IO’s `socket.data` and `socket.id` with a plain object:

```ts
interface WsClient {
  id: string;
  ws: WebSocket;
  user: { id: string; name?: string; email?: string; image?: string };
  channels: Set<string>;
  conversations: Set<string>;
}
```

Maintain a `Map<string, WsClient>` keyed by `id` (e.g. `crypto.randomUUID()`). When the client sends `join_channel` / `leave_channel` / `join_conversation` / `leave_conversation`, update these sets (and your existing `channelClients` / `conversationClients` maps keyed by channel/conversation id).

### 4.5 Receiving messages (replacing socket.on)

- On `ws.on('message', (data) => { ... })`, parse `data` as JSON (if text); if parsing fails, send back an `error` envelope and optionally close.
- Read `type` and `payload` from the envelope and route to the same handlers you have today, e.g.:
  - `send_message` → `handleSendMessage(...)`
  - `edit_message` → `handleEditMessage(...)`
  - `join_channel` / `leave_channel` → update `WsClient` and channel/conversation maps
  - Same for direct messages, reactions, typing, ping, etc.

Reuse all existing handler logic from `websocket/handlers/*` and from `websocket/index.ts`; only the way you pass “socket” and “io” changes (see below).

### 4.6 Sending to a single client

Replace `socket.emit(event, data)` with:

```ts
function sendToClient(client: WsClient, type: string, payload?: Record<string, unknown>) {
  if (client.ws.readyState !== WebSocket.OPEN) return;
  client.ws.send(JSON.stringify({ type, payload: payload ?? {} }));
}
```

Use this for `authenticated`, `error`, `joined_channel`, `left_channel`, `conversation_joined`, `conversation_left`, `pong`, etc.

### 4.7 Rooms (broadcast to channel / conversation / user)

You already have:

- `channelClients: Map<string, Set<Socket>>`
- `conversationClients: Map<string, Set<Socket>>`
- Per-user room: `user_${userId}` (Socket.IO) → with raw WS, maintain e.g. `userClients: Map<string, Set<WsClient>>` or derive from a single `clients: Map<string, WsClient>`.

Replace:

- `io.to(channelId).emit(event, data)` → iterate `channelClients.get(channelId)` and `sendToClient(client, event, data)` for each.
- `io.to(conversationId).emit(...)` → same with `conversationClients`.
- `io.to('user_' + userId).emit(...)` → same with your user-to-clients map.
- `io.emit(...)` (broadcast to all) → iterate all clients and send.

Implement helpers, e.g.:

- `broadcastToChannel(channelId, type, payload)`
- `broadcastToConversation(conversationId, type, payload)`
- `sendToUser(userId, type, payload)`
- `broadcastToAll(type, payload)`

so the rest of the code (handlers + streams consumer) stays almost the same.

### 4.8 Redis (horizontal scaling)

Socket.IO’s Redis adapter syncs “rooms” across instances. With native WS you need to do that yourself:

- **Option A – Redis Pub/Sub**: When you need to broadcast to a room, `PUBLISH ws:room:{channelId} JSON.stringify({ type, payload })`. Every socket-service instance subscribes to the same channel prefix and, when it receives a message, broadcasts to its local connections in that room. You’ll need a clear convention for room names (e.g. `channel:${id}`, `conversation:${id}`, `user:${id}`) and which channels each instance’s clients are in.
- **Option B – Single instance**: If you run one socket-service instance, you can skip Redis for WS and keep Redis only for Streams/cache.

Implement a small “broadcast service” that either sends locally or publishes to Redis so handlers and streams consumer call a single API (e.g. `broadcastToRoom(roomKey, type, payload)`).

### 4.9 Streams consumer

- Replace the Socket.IO dependency with your broadcast API.
- Change `setSocketIOInstance(io)` to something like `setBroadcastSender(send)` where `send(roomKey, type, payload)` does local broadcast and/or Redis PUBLISH.
- In `handleMessageEvent`, `handleNotificationEvent`, etc., replace every `ioInstance.to(...).emit(...)` with the same room keys and your sender, e.g. `send('channel:' + data.channelId, 'new_message', { ... })`.
- **Important**: Align room naming with the main WS server (e.g. main server uses `channelId` as room key → use the same in streams; if you use a prefix like `channel:${id}`, use it everywhere). Today streams uses `conversation:${id}` and `user:${id}`; main index uses `conversationId` and `user_${userId}` — unify these during migration.

### 4.10 Types and handlers

- `websocket/types.ts`: Replace `import { Socket } from 'socket.io'` with your own `WsClient` (or keep a `Socket` type alias pointing to `WsClient`).
- Handlers in `websocket/handlers/*` today take `(socket, data, channelClients, io)`. Change to `(client: WsClient, payload, channelClients, conversationClients, broadcast)` where `broadcast` is your unified “send to room / user” API. Handlers should not call `io.to(...).emit` directly; they call `broadcast.toChannel(...)`, etc.

---

## 5. Client migration (jibbr-electron-fe / jibbr-native-fe)

### 5.1 Dependencies

- **Remove**: `socket.io-client` (and `@types/socket.io-client` if present).
- No new dependency: use the environment’s `WebSocket` (browser or React Native).

### 5.2 URL

- Socket.IO often uses a base URL and path `/socket.io`. With native WS, use a single URL, e.g. `wss://your-api/socket-service/ws` or `ws://localhost:3004/ws`. Ensure the socket-service exposes the WS path you use (e.g. `path: '/ws'` in `WebSocketServer`).
- Replace `VITE_SOCKET_URL` usage with a URL that points at the new WS path (same host/port as before, different path if needed).

### 5.3 SocketService class (same public API)

Keep the same public methods (`connect(token)`, `on(event, cb)`, `off(event, cb)`, `joinChannel`, `leaveChannel`, `sendMessage`, …) so callers don’t change.

- **connect(token)**:
  - Build WS URL with token in query: `const url = `${this.serverUrl}/ws?token=${encodeURIComponent(token)}`; new WebSocket(url)` (or send auth as first message if you chose server Option B).
  - Store the `WebSocket` instance; set `connectionStatus = 'connecting'`.
  - On `open`: set `connectionStatus = 'connected'`, maybe send a first message if you use auth-in-first-message, then resolve the connect promise.
  - On `message`: parse `event.data` as JSON, read `type` and `payload`, then call `this.triggerEventListeners(type, payload)` (or `triggerEventListeners(type, payload)` if you keep the same signature). That way all existing `on('new_message', ...)` etc. still work.
  - On `close` / `error`: set status, trigger reconnection if desired (exponential backoff, same as today).
- **emit-style calls** (joinChannel, sendMessage, …): instead of `this.socket.emit('join_channel', { channelId })`, do `this.socket.send(JSON.stringify({ type: 'join_channel', payload: { channelId } }))`. Use the same `type` and payload shape as today so the server’s new router recognizes them.

Reconnection: implement a simple loop (e.g. on `close`, schedule `connect(token)` again with backoff and max attempts), similar to your current Socket.IO reconnection.

### 5.4 Event names and payloads

Keep event names and payloads identical to what the server sends in the new envelope (e.g. `type: 'new_message'`, `payload: { message }`). Then existing UI code that does `socketService.on('new_message', (message) => ...)` can stay as-is if your `triggerEventListeners` passes the payload as the first argument (or spread) to match current behavior.

---

## 6. Order of migration

1. **Define envelope** and room naming in one place (doc or shared types).
2. **Socket-service**: Implement WS server, envelope parsing, auth, room maps, and broadcast helpers; switch handlers to use them; keep Streams consumer publishing to the same logical rooms via the new broadcast API.
3. **Redis scaling** (if needed): Add Redis pub/sub in socket-service so multiple instances share the same logical rooms.
4. **One client**: Migrate jibbr-electron-fe (or jibbr-native-fe) to the new WebSocket + envelope; test against the new socket-service.
5. **Other clients**: Migrate jibbr-native-fe (and any other clients) the same way.
6. **Cleanup**: Remove Socket.IO and Redis adapter from socket-service and messaging-service; remove `socket.io-client` from all frontends; update any proxy (e.g. Electron’s `/socket.io` proxy) to the new WS path.

---

## 7. Checklist (summary)

- [ ] **socket-service**: Replace Socket.IO with `ws`; implement auth (query or first message).
- [ ] **socket-service**: Envelope format (type + payload) for all messages.
- [ ] **socket-service**: Per-connection state (user, channels, conversations); same room semantics.
- [ ] **socket-service**: Helpers: sendToClient, broadcastToChannel, broadcastToConversation, sendToUser, broadcastToAll.
- [ ] **socket-service**: All current events (send_message, new_message, join_channel, typing_start, …) handled via envelope routing.
- [ ] **socket-service**: Streams consumer uses new broadcast API; room names aligned with main server.
- [ ] **socket-service**: (Optional) Redis pub/sub for multi-instance broadcasting.
- [ ] **Clients**: Replace socket.io-client with WebSocket; same public SocketService API; reconnection logic.
- [ ] **Clients**: Send envelope for every action; dispatch incoming messages by `type` to existing listeners.
- [ ] **Env/proxy**: WS URL and path (e.g. `/ws`) configured; remove Socket.IO path from proxies (e.g. electron.vite.config `'/socket.io'`).
- [ ] **messaging-service**: Remove `socket.io` and `@socket.io/redis-adapter` if no longer used (only Streams publishing remains).

After this, jibbr-turbo-repo will use native WebSockets end-to-end while preserving the same event names, payloads, and room behavior as today.
