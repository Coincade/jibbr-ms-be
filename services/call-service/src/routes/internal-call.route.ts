import { conversationRoomId } from '../utils/room-id.js';
import { getRoomSnapshot, removePeer } from '../mediasoup/rooms.js';

const verifyInternal = (req: { header: (name: string) => string | undefined }, res: {
  status: (code: number) => { json: (body: unknown) => void };
}): boolean => {
  const expected = process.env.INTERNAL_SERVICE_SECRET?.trim();
  if (!expected) {
    res.status(503).json({ error: 'Internal signaling not configured' });
    return false;
  }
  const provided = req.header('X-Internal-Secret');
  if (provided !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
};

const resolveRoomId = (body: Record<string, unknown>): string => {
  if (typeof body.roomId === 'string' && body.roomId) return body.roomId;
  if (typeof body.conversationId === 'string' && body.conversationId) {
    return conversationRoomId(body.conversationId);
  }
  if (typeof body.channelId === 'string' && body.channelId) return body.channelId;
  return '';
};

/**
 * Server-to-server: remove a peer from an SFU room after membership revoke.
 * Body: { userId, channelId? } | { userId, conversationId? } | { userId, roomId? }
 */
export const kickPeerInternal = async (
  req: {
    header: (name: string) => string | undefined;
    body?: Record<string, unknown>;
  },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    json: (body: unknown) => void;
  }
): Promise<void> => {
  if (!verifyInternal(req, res)) return;

  const body = req.body ?? {};
  const userId = typeof body.userId === 'string' ? body.userId : '';
  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }

  const roomId = resolveRoomId(body);
  if (!roomId) {
    res.status(400).json({ error: 'channelId, conversationId, or roomId required' });
    return;
  }

  try {
    const result = await removePeer(roomId, userId);
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[internal-call] kick-peer failed:', error);
    res.status(500).json({ error: 'Failed to kick peer' });
  }
};

/**
 * Server-to-server: resolve whether a user is the current huddle host.
 * Used by socket-service to gate *_call_end fan-out while a room is still live.
 */
export const hostCheckInternal = async (
  req: {
    header: (name: string) => string | undefined;
    body?: Record<string, unknown>;
  },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    json: (body: unknown) => void;
  }
): Promise<void> => {
  if (!verifyInternal(req, res)) return;

  const body = req.body ?? {};
  const userId = typeof body.userId === 'string' ? body.userId : '';
  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }

  const roomId = resolveRoomId(body);
  if (!roomId) {
    res.status(400).json({ error: 'channelId, conversationId, or roomId required' });
    return;
  }

  const snapshot = getRoomSnapshot(roomId);
  if (!snapshot) {
    res.json({
      ok: true,
      active: false,
      hostUserId: null,
      isHost: false,
      participantCount: 0,
    });
    return;
  }

  res.json({
    ok: true,
    active: true,
    hostUserId: snapshot.hostUserId ?? null,
    isHost: snapshot.hostUserId === userId,
    participantCount: snapshot.participantCount ?? 0,
  });
};
