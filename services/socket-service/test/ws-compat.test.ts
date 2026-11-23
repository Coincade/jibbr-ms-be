import { createServer } from 'http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createWsServer, extractTokenFromProtocols } from '../src/websocket/ws-compat.js';

function fakeWs() {
  return {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
  } as any;
}

describe('ws-compat', () => {
  const servers: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  it('extracts the jwt that follows the jibbr subprotocol', () => {
    expect(extractTokenFromProtocols({ headers: {} } as any)).toBeNull();
    expect(
      extractTokenFromProtocols({ headers: { 'sec-websocket-protocol': 'jibbr' } } as any)
    ).toBeNull();
    expect(
      extractTokenFromProtocols({
        headers: { 'sec-websocket-protocol': 'Jibbr, token-1' },
      } as any)
    ).toBe('token-1');
  });

  it('joins, emits, leaves, and counts clients without binding a port', () => {
    const httpServer = createServer();
    const { wss, io, createSocketFromWs, getRoomMap, parseIncomingFrame } = createWsServer(httpServer);
    servers.push(wss);

    const ws = fakeWs();
    const socket = createSocketFromWs(ws);
    expect(io.clientsCount()).toBe(1);

    socket.join('room-1');
    socket.emit('ready', { ok: true });
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ready', ok: true }));
    expect(getRoomMap().get('room-1')?.has(socket)).toBe(true);

    io.to('room-1').emit('ping', { n: 1 });
    socket.leave('room-1');
    expect(getRoomMap().has('room-1')).toBe(false);

    expect(parseIncomingFrame(Buffer.from('{"type":"join","room":"r"}'))).toEqual({
      type: 'join',
      data: { type: 'join', room: 'r' },
    });
    expect(parseIncomingFrame(Buffer.from('not-json'))).toBeNull();
  });
});
