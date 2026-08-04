import type { Request, Response } from 'express';
import type { AuthRequest } from '@jibbr/auth-middleware';
import { z } from 'zod';
import { getIceServers, getWebRtcTransportOptions, isTurnConfigured } from '../config/mediasoup.js';
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
  findProducerInRoom,
} from '../mediasoup/rooms.js';
import type { ProducerSource } from '../mediasoup/producer-source.js';
import { producerSourceFromProducer } from '../mediasoup/producer-source.js';
import { emitProducerClosed, emitWorkspaceHuddleUpdate } from '../services/call-signal.service.js';
import { assertRoomMember } from '../services/membership.service.js';
import {
  startHuddleSessionRecord,
  listRecentHuddles,
  listChannelHuddleHistory,
} from '../services/huddle-session.service.js';
import {
  listLiveHuddlesForWorkspace,
  assertWorkspaceMember,
  buildWorkspaceHuddlePayload,
  resolveWorkspaceIdForRoom,
} from '../services/huddle-live.service.js';
import { recordCallStatsEvent } from '../services/call-stats.service.js';
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
  source: z.enum(['camera', 'screen']).optional(),
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
  raisedHand: z.boolean().optional(),
});

const MAX_PARTICIPANTS = Number.parseInt(process.env.MAX_HUDDLE_PARTICIPANTS || '25', 10);

const getUserId = (req: Request): string => {
  const user = (req as AuthRequest).user;
  if (!user?.id) throw new Error('Unauthorized');
  return user.id;
};

const isMembershipDeniedMessage = (message: string): boolean =>
  message.includes('not a member') || message.includes('participant');

const callErrorStatus = (error: unknown, fallback = 400): number => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Unauthorized') return 401;
  if (isMembershipDeniedMessage(message)) return 403;
  return fallback;
};

const joinRoom = async (req: Request, res: Response, roomId: string): Promise<void> => {
  const userId = getUserId(req);
  await assertRoomMember(userId, roomId);

  const existing = getRoom(roomId);
  const displayName = (req as AuthRequest).user?.name ?? undefined;

  let room = existing;
  if (!room) {
    room = await getOrCreateRoom(roomId, { hostUserId: userId });
  }
  // Single open session per room (idempotent under concurrent first joins).
  if (!room.huddleDbId) {
    const huddleDbId = await startHuddleSessionRecord(roomId, userId, room.sessionId);
    if (huddleDbId) room.huddleDbId = huddleDbId;
  }

  // Enforce participant cap before adding the new peer
  if (!room.peers.has(userId) && room.peers.size >= MAX_PARTICIPANTS) {
    res.status(403).json({ error: 'huddle_full', message: `This huddle is full (max ${MAX_PARTICIPANTS} participants)` });
    return;
  }

  getOrCreatePeer(room, userId, displayName);

  const snapshotAfterJoin = getRoomSnapshot(roomId);
  if (snapshotAfterJoin) {
    const workspaceId = await resolveWorkspaceIdForRoom(roomId);
    if (workspaceId) {
      void emitWorkspaceHuddleUpdate(
        workspaceId,
        buildWorkspaceHuddlePayload(workspaceId, roomId, snapshotAfterJoin)
      );
    }
  }

  const existingProducers = listRemoteProducers(room, userId);
  const participants = listOtherParticipants(room, userId);

  res.json({
    channelId: roomId,
    roomId,
    sessionId: room.sessionId,
    hostUserId: room.hostUserId,
    routerRtpCapabilities: room.router.rtpCapabilities,
    iceServers: getIceServers(),
    turnConfigured: isTurnConfigured(),
    participantMax: MAX_PARTICIPANTS,
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
    res.status(callErrorStatus(error)).json({ error: message });
  }
};

export const joinConversationCall = async (req: Request, res: Response): Promise<void> => {
  try {
    const { conversationId } = z.object({ conversationId: z.string().min(1) }).parse(req.params);
    await joinRoom(req, res, conversationRoomId(conversationId));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to join call';
    res.status(callErrorStatus(error)).json({ error: message });
  }
};

export const leaveRoomCall = async (req: Request, res: Response, roomId: string): Promise<void> => {
  const userId = getUserId(req);
  await assertRoomMember(userId, roomId);
  const { roomEmptied } = await removePeer(roomId, userId);
  res.json({ ok: true, roomEmptied });
};

export const leaveChannelCall = async (req: Request, res: Response): Promise<void> => {
  try {
    const { channelId } = z.object({ channelId: z.string().min(1) }).parse(req.params);
    await leaveRoomCall(req, res, channelId);
  } catch (error) {
    res.status(callErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Failed to leave call',
    });
  }
};

export const leaveConversationCall = async (req: Request, res: Response): Promise<void> => {
  try {
    const { conversationId } = z.object({ conversationId: z.string().min(1) }).parse(req.params);
    await leaveRoomCall(req, res, conversationRoomId(conversationId));
  } catch (error) {
    res.status(callErrorStatus(error)).json({
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
    res.status(callErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Failed to get call',
    });
  }
};

export const getConversationCall = async (req: Request, res: Response): Promise<void> => {
  try {
    const { conversationId } = z.object({ conversationId: z.string().min(1) }).parse(req.params);
    await getRoomCall(req, res, conversationRoomId(conversationId));
  } catch (error) {
    res.status(callErrorStatus(error)).json({
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
    res.status(callErrorStatus(error)).json({
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
    res.status(callErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Failed to end call',
    });
  }
};

export const updateCallMediaState = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { channelId, audioMuted, videoMuted, raisedHand } = mediaStateBody.parse(req.body);
    await assertRoomMember(userId, channelId);

    const peer = setPeerMediaState(channelId, userId, { audioMuted, videoMuted, raisedHand });
    if (!peer) {
      res.status(404).json({ error: 'Peer not in call' });
      return;
    }

    res.json({
      userId,
      audioMuted: peer.audioMuted,
      videoMuted: peer.videoMuted,
      raisedHand: peer.raisedHand,
    });
  } catch (error) {
    res.status(callErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Failed to update media state',
    });
  }
};

export const listWorkspaceHuddleHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(req.params);
    await assertWorkspaceMember(userId, workspaceId);
    const limit = z.coerce.number().min(1).max(50).optional().parse(req.query.limit ?? 20);
    const sessions = await listRecentHuddles(workspaceId, userId, limit);
    res.json({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list huddle history';
    const status = message.includes('not a member') ? 403 : 400;
    res.status(status).json({ error: message });
  }
};

export const listWorkspaceHuddlesLive = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(req.params);
    const huddles = await listLiveHuddlesForWorkspace(workspaceId, userId);
    res.json({ huddles });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list live huddles';
    const status = message.includes('not a member') ? 403 : 400;
    res.status(status).json({ error: message });
  }
};

export const listChannelHuddlesHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { channelId } = z.object({ channelId: z.string().min(1) }).parse(req.params);
    await assertRoomMember(userId, channelId);
    const limit = z.coerce.number().min(1).max(50).optional().parse(req.query.limit ?? 20);
    const sessions = await listChannelHuddleHistory(channelId, limit);
    res.json({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list channel huddle history';
    const status =
      message.includes('not a member') || message.includes('participant') ? 403 : 400;
    res.status(status).json({ error: message });
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

    const peer = room.peers.get(userId);
    if (!peer) {
      res.status(404).json({ error: 'Peer not in call. Join the huddle before creating a transport.' });
      return;
    }
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
    res.status(callErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Failed to create transport',
    });
  }
};

export const connectWebRtcTransport = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const transportId = z.string().parse(req.params.transportId);
    const { channelId, dtlsParameters } = connectTransportBody.parse(req.body);

    await assertRoomMember(userId, channelId);
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
    res.status(callErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Failed to connect transport',
    });
  }
};

export const produce = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { channelId, transportId, kind, rtpParameters, source } = produceBody.parse(req.body);

    await assertRoomMember(userId, channelId);
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

    const videoSource: ProducerSource | undefined =
      kind === 'video' ? (source ?? 'camera') : undefined;

    const producer = await peer.sendTransport.produce({
      kind,
      rtpParameters: rtpParameters as any,
      appData: videoSource ? { source: videoSource } : {},
    });

    peer.producers.set(producer.id, producer);

    const notifyProducerClosed = () => {
      if (!peer.producers.has(producer.id)) return;
      peer.producers.delete(producer.id);
      void emitProducerClosed(
        channelId,
        userId,
        producer.id,
        kind,
        videoSource
      );
    };

    producer.on('transportclose', notifyProducerClosed);
    producer.observer.on('close', notifyProducerClosed);

    res.json({
      producerId: producer.id,
      ...(videoSource ? { source: videoSource } : {}),
    });
  } catch (error) {
    res.status(callErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Failed to produce',
    });
  }
};

export const consume = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { channelId, transportId, producerId, rtpCapabilities } = consumeBody.parse(req.body);

    await assertRoomMember(userId, channelId);
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

    const found = findProducerInRoom(room, producerId);
    const source =
      found && found.producer.kind === 'video'
        ? producerSourceFromProducer(found.producer)
        : undefined;

    res.json({
      consumerId: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      ...(source ? { source } : {}),
    });
  } catch (error) {
    res.status(callErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Failed to consume',
    });
  }
};

export const resumeConsumer = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const consumerId = z.string().parse(req.params.consumerId);
    const channelId = z.string().parse(req.body?.channelId);

    await assertRoomMember(userId, channelId);
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
    res.status(callErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Failed to resume consumer',
    });
  }
};

const pauseResumeProducerBody = z.object({ channelId: z.string().min(1) });

export const pauseProducer = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const producerId = z.string().parse(req.params.producerId);
    const { channelId } = pauseResumeProducerBody.parse(req.body);

    await assertRoomMember(userId, channelId);
    const room = getRoom(channelId);
    if (!room) { res.status(404).json({ error: 'No active call' }); return; }

    const peer = room.peers.get(userId);
    const producer = peer?.producers.get(producerId);
    if (!producer) { res.status(404).json({ error: 'Producer not found' }); return; }

    await producer.pause();
    res.json({ paused: true });
  } catch (error) {
    res.status(callErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Failed to pause producer',
    });
  }
};

export const resumeProducer = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const producerId = z.string().parse(req.params.producerId);
    const { channelId } = pauseResumeProducerBody.parse(req.body);

    await assertRoomMember(userId, channelId);
    const room = getRoom(channelId);
    if (!room) { res.status(404).json({ error: 'No active call' }); return; }

    const peer = room.peers.get(userId);
    const producer = peer?.producers.get(producerId);
    if (!producer) { res.status(404).json({ error: 'Producer not found' }); return; }

    await producer.resume();
    res.json({ resumed: true });
  } catch (error) {
    res.status(callErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Failed to resume producer',
    });
  }
};

const consumerLayersBody = z.object({
  channelId: z.string().min(1),
  spatialLayer: z.number().int().min(0).max(2),
  temporalLayer: z.number().int().min(0).max(2).optional(),
});

export const setConsumerLayers = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const consumerId = z.string().parse(req.params.consumerId);
    const { channelId, spatialLayer, temporalLayer } = consumerLayersBody.parse(req.body);

    await assertRoomMember(userId, channelId);
    const room = getRoom(channelId);
    if (!room) { res.status(404).json({ error: 'No active call' }); return; }

    const peer = room.peers.get(userId);
    const consumer = peer?.consumers.get(consumerId);
    if (!consumer) { res.status(404).json({ error: 'Consumer not found' }); return; }

    await consumer.setPreferredLayers({ spatialLayer, temporalLayer: temporalLayer ?? spatialLayer });
    res.json({ ok: true, spatialLayer });
  } catch (error) {
    res.status(callErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Failed to set consumer layers',
    });
  }
};

const statsBody = z.object({
  channelId: z.string().min(1),
  rttMs: z.number().nullable().optional(),
  packetsLostPct: z.number().optional(),
  outboundBitrateKbps: z.number().optional(),
  callQuality: z.enum(['good', 'poor', 'bad']).optional(),
});

export const recordCallStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const body = statsBody.parse(req.body);
    recordCallStatsEvent({
      userId,
      roomId: body.channelId,
      rttMs: body.rttMs,
      packetsLostPct: body.packetsLostPct,
      outboundBitrateKbps: body.outboundBitrateKbps,
      callQuality: body.callQuality,
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to record stats' });
  }
};
