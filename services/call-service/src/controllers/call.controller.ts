import type { Request, Response } from 'express';
import type { AuthRequest } from '@jibbr/auth-middleware';
import { z } from 'zod';
import { getIceServers, getWebRtcTransportOptions } from '../config/mediasoup.js';
import {
  getOrCreatePeer,
  getOrCreateRoom,
  getRoom,
  listOtherParticipants,
  listRemoteProducers,
  removePeer,
  getRoomSnapshot,
  forceCloseRoom,
  setPeerMediaState,
} from '../mediasoup/rooms.js';
import { assertRoomMember } from '../services/membership.service.js';
import {
  startHuddleSessionRecord,
  listRecentHuddles,
} from '../services/huddle-session.service.js';
import { conversationRoomId } from '../utils/room-id.js';

const roomIdBody = z.object({
  channelId: z.string().min(1),
});

const transportBody = z.object({
  channelId: z.string().min(1),
  direction: z.enum(['send', 'recv']),
});

const connectTransportBody = z.object({
  channelId: z.string().min(1),
  dtlsParameters: z.record(z.unknown()),
});

const produceBody = z.object({
  channelId: z.string().min(1),
  transportId: z.string().min(1),
  kind: z.enum(['audio', 'video']),
  rtpParameters: z.record(z.unknown()),
});

const consumeBody = z.object({
  channelId: z.string().min(1),
  transportId: z.string().min(1),
  producerId: z.string().min(1),
  rtpCapabilities: z.record(z.unknown()),
});

const mediaStateBody = z.object({
  channelId: z.string().min(1),
  audioMuted: z.boolean().optional(),
  videoMuted: z.boolean().optional(),
});

const getUserId = (req: Request): string => {
  const user = (req as AuthRequest).user;
  if (!user?.id) throw new Error('Unauthorized');
  return user.id;
};

const joinRoom = async (req: Request, res: Response, roomId: string): Promise<void> => {
  const userId = getUserId(req);
  await assertRoomMember(userId, roomId);

  const existing = getRoom(roomId);
  const displayName = (req as AuthRequest).user?.name ?? undefined;

  let room = existing;
  if (!room) {
    room = await getOrCreateRoom(roomId, { hostUserId: userId });
    const huddleDbId = await startHuddleSessionRecord(roomId, userId, room.sessionId);
    if (huddleDbId) room.huddleDbId = huddleDbId;
  }

  getOrCreatePeer(room, userId, displayName);

  const existingProducers = listRemoteProducers(room, userId);
  const participants = listOtherParticipants(room, userId);

  res.json({
    channelId: roomId,
    roomId,
    sessionId: room.sessionId,
    hostUserId: room.hostUserId,
    routerRtpCapabilities: room.router.rtpCapabilities,
    iceServers: getIceServers(),
    existingProducers,
    participants,
  });
};

export const joinChannelCall = async (req: Request, res: Response): Promise<void> => {
  try {
    const { channelId } = z.object({ channelId: z.string().min(1) }).parse(req.params);
    await joinRoom(req, res, channelId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to join call';
    const status = message.includes('not a member') || message.includes('participant') ? 403 : 400;
    res.status(status).json({ error: message });
  }
};

export const joinConversationCall = async (req: Request, res: Response): Promise<void> => {
  try {
    const { conversationId } = z.object({ conversationId: z.string().min(1) }).parse(req.params);
    await joinRoom(req, res, conversationRoomId(conversationId));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to join call';
    const status = message.includes('participant') ? 403 : 400;
    res.status(status).json({ error: message });
  }
};

export const leaveRoomCall = async (req: Request, res: Response, roomId: string): Promise<void> => {
  const userId = getUserId(req);
  const { roomEmptied } = await removePeer(roomId, userId);
  res.json({ ok: true, roomEmptied });
};

export const leaveChannelCall = async (req: Request, res: Response): Promise<void> => {
  try {
    const { channelId } = z.object({ channelId: z.string().min(1) }).parse(req.params);
    await leaveRoomCall(req, res, channelId);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to leave call',
    });
  }
};

export const leaveConversationCall = async (req: Request, res: Response): Promise<void> => {
  try {
    const { conversationId } = z.object({ conversationId: z.string().min(1) }).parse(req.params);
    await leaveRoomCall(req, res, conversationRoomId(conversationId));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to leave call',
    });
  }
};

const getRoomCall = async (req: Request, res: Response, roomId: string): Promise<void> => {
  const userId = getUserId(req);
  await assertRoomMember(userId, roomId);

  const snapshot = getRoomSnapshot(roomId);
  if (!snapshot) {
    res.json({ active: false, roomId });
    return;
  }

  res.json({ active: true, ...snapshot });
};

export const getChannelCall = async (req: Request, res: Response): Promise<void> => {
  try {
    const { channelId } = z.object({ channelId: z.string().min(1) }).parse(req.params);
    await getRoomCall(req, res, channelId);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to get call',
    });
  }
};

export const getConversationCall = async (req: Request, res: Response): Promise<void> => {
  try {
    const { conversationId } = z.object({ conversationId: z.string().min(1) }).parse(req.params);
    await getRoomCall(req, res, conversationRoomId(conversationId));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to get call',
    });
  }
};

export const endChannelCall = async (req: Request, res: Response): Promise<void> => {
  try {
    const { channelId } = z.object({ channelId: z.string().min(1) }).parse(req.params);
    const userId = getUserId(req);
    await assertRoomMember(userId, channelId);

    const room = getRoom(channelId);
    if (!room) {
      res.json({ ok: true, ended: false });
      return;
    }

    if (room.hostUserId !== userId) {
      res.status(403).json({ error: 'Only the huddle host can end the call for everyone' });
      return;
    }

    await forceCloseRoom(channelId);
    res.json({ ok: true, ended: true, roomEmptied: true });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to end call',
    });
  }
};

export const endConversationCall = async (req: Request, res: Response): Promise<void> => {
  try {
    const { conversationId } = z.object({ conversationId: z.string().min(1) }).parse(req.params);
    const roomId = conversationRoomId(conversationId);
    const userId = getUserId(req);
    await assertRoomMember(userId, roomId);

    const room = getRoom(roomId);
    if (!room) {
      res.json({ ok: true, ended: false });
      return;
    }

    if (room.hostUserId !== userId) {
      res.status(403).json({ error: 'Only the huddle host can end the call for everyone' });
      return;
    }

    await forceCloseRoom(roomId);
    res.json({ ok: true, ended: true, roomEmptied: true });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to end call',
    });
  }
};

export const updateCallMediaState = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { channelId, audioMuted, videoMuted } = mediaStateBody.parse(req.body);
    await assertRoomMember(userId, channelId);

    const peer = setPeerMediaState(channelId, userId, { audioMuted, videoMuted });
    if (!peer) {
      res.status(404).json({ error: 'Peer not in call' });
      return;
    }

    res.json({
      userId,
      audioMuted: peer.audioMuted,
      videoMuted: peer.videoMuted,
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to update media state',
    });
  }
};

export const listWorkspaceHuddleHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(req.params);
    const limit = z.coerce.number().min(1).max(50).optional().parse(req.query.limit ?? 20);
    const sessions = await listRecentHuddles(workspaceId, limit);
    res.json({ sessions });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to list huddle history',
    });
  }
};

export const createWebRtcTransport = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { channelId, direction } = transportBody.parse(req.body);

    await assertRoomMember(userId, channelId);
    const room = getRoom(channelId);
    if (!room) {
      res.status(404).json({ error: 'No active call in this room' });
      return;
    }

    const peer = getOrCreatePeer(room, userId);
    const transport = await room.router.createWebRtcTransport(getWebRtcTransportOptions());

    transport.on('dtlsstatechange', (state) => {
      if (state === 'closed') transport.close();
    });

    if (direction === 'send') {
      peer.sendTransport?.close();
      peer.sendTransport = transport;
    } else {
      peer.recvTransport?.close();
      peer.recvTransport = transport;
    }

    res.json({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to create transport',
    });
  }
};

export const connectWebRtcTransport = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const transportId = z.string().parse(req.params.transportId);
    const { channelId, dtlsParameters } = connectTransportBody.parse(req.body);

    const room = getRoom(channelId);
    if (!room) {
      res.status(404).json({ error: 'No active call in this room' });
      return;
    }

    const peer = room.peers.get(userId);
    if (!peer) {
      res.status(404).json({ error: 'Peer not in call' });
      return;
    }

    const transport =
      peer.sendTransport?.id === transportId
        ? peer.sendTransport
        : peer.recvTransport?.id === transportId
          ? peer.recvTransport
          : undefined;

    if (!transport) {
      res.status(404).json({ error: 'Transport not found' });
      return;
    }

    await transport.connect({ dtlsParameters: dtlsParameters as any });
    res.json({ connected: true });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to connect transport',
    });
  }
};

export const produce = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { channelId, transportId, kind, rtpParameters } = produceBody.parse(req.body);

    const room = getRoom(channelId);
    if (!room) {
      res.status(404).json({ error: 'No active call in this room' });
      return;
    }

    const peer = room.peers.get(userId);
    if (!peer?.sendTransport || peer.sendTransport.id !== transportId) {
      res.status(404).json({ error: 'Send transport not found' });
      return;
    }

    const producer = await peer.sendTransport.produce({
      kind,
      rtpParameters: rtpParameters as any,
    });

    peer.producers.set(producer.id, producer);

    producer.on('transportclose', () => {
      peer.producers.delete(producer.id);
    });

    res.json({ producerId: producer.id });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to produce',
    });
  }
};

export const consume = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { channelId, transportId, producerId, rtpCapabilities } = consumeBody.parse(req.body);

    const room = getRoom(channelId);
    if (!room) {
      res.status(404).json({ error: 'No active call in this room' });
      return;
    }

    if (!room.router.canConsume({ producerId, rtpCapabilities: rtpCapabilities as any })) {
      res.status(400).json({ error: 'Cannot consume producer' });
      return;
    }

    const peer = room.peers.get(userId);
    if (!peer?.recvTransport || peer.recvTransport.id !== transportId) {
      res.status(404).json({ error: 'Recv transport not found' });
      return;
    }

    const consumer = await peer.recvTransport.consume({
      producerId,
      rtpCapabilities: rtpCapabilities as any,
      paused: true,
    });

    peer.consumers.set(consumer.id, consumer);

    consumer.on('transportclose', () => {
      peer.consumers.delete(consumer.id);
    });

    res.json({
      consumerId: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to consume',
    });
  }
};

export const resumeConsumer = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const consumerId = z.string().parse(req.params.consumerId);
    const channelId = z.string().parse(req.body?.channelId);

    const room = getRoom(channelId);
    if (!room) {
      res.status(404).json({ error: 'No active call in this room' });
      return;
    }

    const peer = room.peers.get(userId);
    const consumer = peer?.consumers.get(consumerId);
    if (!consumer) {
      res.status(404).json({ error: 'Consumer not found' });
      return;
    }

    await consumer.resume();
    res.json({ resumed: true });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to resume consumer',
    });
  }
};
