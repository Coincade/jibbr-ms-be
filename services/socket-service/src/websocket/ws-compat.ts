import type { Server as HttpServer } from 'http';
import crypto from 'crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { authenticateSocket } from './utils.js';

export type WsUser = { id: string; name?: string; email?: string; image?: string };

export type JsonRecord = Record<string, any>;

export interface IoLike {
  emit: (event: string, data?: JsonRecord) => void;
  to: (room: string) => { emit: (event: string, data?: JsonRecord) => void };
  /** Active connections count */
  clientsCount: () => number;
}

export interface SocketLike {
  id: string;
  data: { user?: WsUser };
  on: (event: string, cb: (data?: any) => void) => void;
  emit: (event: string, data?: JsonRecord) => void;
  to: (room: string) => { emit: (event: string, data?: JsonRecord) => void };
  join: (room: string) => void;
  leave: (room: string) => void;
  disconnect: (code?: number, reason?: string) => void;
  /** Internal: raw WebSocket instance */
  ws: WebSocket;
}

type RoomMap = Map<string, Set<WsSocket>>;

const safeJsonParse = (raw: string): any | null => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const sendFrame = (ws: WebSocket, frame: any) => {
  if (ws.readyState !== WebSocket.OPEN) return;
  // Basic backpressure guard: if client is slow, avoid unbounded buffering.
  // Typing/presence are best-effort and will be dropped by callers if needed.
  if ((ws as any).bufferedAmount && (ws as any).bufferedAmount > 2_000_000) return;
  ws.send(JSON.stringify(frame));
};

const sendJson = (ws: WebSocket, json: string) => {
  if (ws.readyState !== WebSocket.OPEN) return;
  if ((ws as any).bufferedAmount && (ws as any).bufferedAmount > 2_000_000) return;
  ws.send(json);
};

class WsSocket implements SocketLike {
  public readonly id: string;
  public readonly ws: WebSocket;
  public data: { user?: WsUser } = {};
  private readonly listeners = new Map<string, Set<(data?: any) => void>>();
  private readonly rooms: Set<string> = new Set();
  private readonly roomMap: RoomMap;
  private readonly allClients: Set<WsSocket>;

  constructor(ws: WebSocket, roomMap: RoomMap, allClients: Set<WsSocket>) {
    this.id = crypto.randomUUID();
    this.ws = ws;
    this.roomMap = roomMap;
    this.allClients = allClients;
  }

  on(event: string, cb: (data?: any) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  /** Called by server when a frame arrives */
  _dispatchIncoming(type: string, payload: any) {
    const cbs = this.listeners.get(type);
    if (!cbs || cbs.size === 0) return;
    cbs.forEach((cb) => cb(payload));
  }

  emit(event: string, data: JsonRecord = {}) {
    sendFrame(this.ws, { type: event, ...(data ?? {}) });
  }

  to(room: string) {
    return {
      emit: (event: string, data: JsonRecord = {}) => {
        const clients = this.roomMap.get(room);
        if (!clients) return;
        const json = JSON.stringify({ type: event, ...(data ?? {}) });
        clients.forEach((client) => {
          if (client.id === this.id) return;
          sendJson(client.ws, json);
        });
      },
    };
  }

  join(room: string) {
    if (!room) return;
    this.rooms.add(room);
    if (!this.roomMap.has(room)) this.roomMap.set(room, new Set());
    this.roomMap.get(room)!.add(this);
  }

  leave(room: string) {
    if (!room) return;
    this.rooms.delete(room);
    const clients = this.roomMap.get(room);
    if (!clients) return;
    clients.delete(this);
    if (clients.size === 0) this.roomMap.delete(room);
  }

  _leaveAll() {
    Array.from(this.rooms).forEach((room) => this.leave(room));
  }

  disconnect(code = 1000, reason = 'disconnect') {
    try {
      this.ws.close(code, reason);
    } catch {
      // ignore
    }
  }
}

export function createWsServer(server: HttpServer): {
  wss: WebSocketServer;
  io: IoLike;
  createSocketFromWs: (ws: WebSocket) => WsSocket;
  getRoomMap: () => RoomMap;
  getAllClients: () => Set<WsSocket>;
  authenticateFromRequestUrl: (requestUrl?: string | null) => WsUser | null;
  parseIncomingFrame: (raw: RawData) => { type: string; data: any } | null;
} {
  const roomMap: RoomMap = new Map();
  const allClients: Set<WsSocket> = new Set();

  const wss = new WebSocketServer({ server, path: '/ws' });

  const io: IoLike = {
    emit: (event: string, data: JsonRecord = {}) => {
      const json = JSON.stringify({ type: event, ...(data ?? {}) });
      allClients.forEach((client) => sendJson(client.ws, json));
    },
    to: (room: string) => ({
      emit: (event: string, data: JsonRecord = {}) => {
        const clients = roomMap.get(room);
        if (!clients) return;
        const json = JSON.stringify({ type: event, ...(data ?? {}) });
        clients.forEach((client) => sendJson(client.ws, json));
      },
    }),
    clientsCount: () => allClients.size,
  };

  const createSocketFromWs = (ws: WebSocket) => {
    const sock = new WsSocket(ws, roomMap, allClients);
    allClients.add(sock);
    return sock;
  };

  const authenticateFromRequestUrl = (requestUrl?: string | null): WsUser | null => {
    if (!requestUrl) return null;
    try {
      const url = new URL(requestUrl, 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) return null;
      const user = authenticateSocket(token);
      if (!user) return null;
      return {
        id: String((user as any).id),
        name: (user as any).name,
        email: (user as any).email,
        image: (user as any).image,
      };
    } catch {
      return null;
    }
  };

  const parseIncomingFrame = (raw: RawData) => {
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');
    const parsed = safeJsonParse(text);
    if (!parsed || typeof parsed !== 'object') return null;
    const type = parsed.type;
    if (!type || typeof type !== 'string') return null;
    return { type, data: parsed };
  };

  return {
    wss,
    io,
    createSocketFromWs,
    getRoomMap: () => roomMap,
    getAllClients: () => allClients,
    authenticateFromRequestUrl,
    parseIncomingFrame,
  };
}

