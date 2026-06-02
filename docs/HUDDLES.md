# Jibbr Huddles — Electron + backend runbook

Slack-style voice/video in channels and DMs. **Media** on `call-service` (droplet); **presence** on `socket-service` (App Platform).

## Architecture

```text
Electron (CallProvider + MediasoupSession)
  REST  → call-service (mediasoup SFU, UDP 40000–49999)
  WS    → socket-service (channel_call_* / conversation_call_* / workspace_huddle_updated)
  HTTP  ← call-service → socket-service /internal/call/* (producer_closed, workspace fan-out, chat messages)
```

## Environment (production)

| Variable | Service | Purpose |
|----------|---------|---------|
| `JWT_SECRET` | auth, socket, call | Same value everywhere |
| `INTERNAL_SERVICE_SECRET` | call + socket | Internal HTTP auth |
| `SOCKET_SERVICE_INTERNAL_URL` | call-service | e.g. `https://<socket-app>` |
| `MEDIASOUP_ANNOUNCED_IP` | call-service | Droplet public IPv4 |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | call-service | NAT traversal |

See also [DEPLOY_CALL_SERVICE.md](./DEPLOY_CALL_SERVICE.md).

## REST API (call-service)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/channels/:id/call/join` | Join channel huddle |
| GET | `/channels/:id/call` | Active snapshot |
| GET | `/channels/:id/huddles/history` | Channel huddle history |
| GET | `/workspaces/:id/huddles/live` | Live huddles (membership-filtered) |
| GET | `/workspaces/:id/huddles/history` | Workspace history |

DM rooms use `conv:{conversationId}` and `/conversations/:id/call/*`.

## Socket events

**Channel / DM (room-scoped):** `channel_call_started`, `participant_joined`, `participant_left`, `new_producer`, `producer_closed`, `ended` (and `conversation_call_*`).

**Workspace (strip / discovery):** `workspace_huddle_updated` — emitted to `workspace:{workspaceId}` on start/join/end and from call-service when a room closes.

**Chat:** `new_message` / `new_direct_message` for huddle-ended system posts (`[jibbr:huddle-ended]{...}` in DB content).

## Client behavior

- **Live list:** `GET .../huddles/live` on workspace load, reconnect, focus, and every 90s; deltas via `workspace_huddle_updated`.
- **In-call sync:** 30s `syncRemoteParticipants` fallback only while in a call (not for discovery).
- **Pre-join:** device sheet once per install (`localStorage`); incoming huddle joins skip it.
- **One huddle:** confirm before leaving current huddle to join another.

## Deploy order

1. call-service (droplet)
2. socket-service (internal routes + workspace fan-out)
3. Electron build

## Smoke test

1. User A starts huddle in `#general` — User B sees strip + ring.
2. User B joins from toast / strip — audio works; camera optional.
3. Screen share — spotlight for both.
4. Last person leaves — channel system message “Huddle ended · N min · M people”.
5. Strip clears within one socket event (or ≤90s reconcile).
