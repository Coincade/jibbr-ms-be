import { randomUUID } from 'crypto';
import type {
  Consumer,
  Producer,
  Router,
  WebRtcTransport,
} from 'mediasoup/types';
import { getNextWorker, setOnWorkerDied, trackRoomOnWorker, untrackRoomOnWorker } from './workers.js';
import { mediaCodecs } from '../config/mediasoup.js';
import { persistRoom, deletePersistedRoom, getPersistedRoom } from './rooms-redis.js';
import { endHuddleSessionRecord } from '../services/huddle-session.service.js';
import { createHuddleEndedMessage } from '../services/huddle-ended-message.service.js';
import {
  buildWorkspaceHuddleInactivePayload,
  buildWorkspaceHuddlePayload,
  resolveWorkspaceIdForRoom,
} from '../services/huddle-live.service.js';
import { emitWorkspaceHuddleUpdate } from '../services/call-signal.service.js';
import { producerSourceFromProducer, type ProducerSource } from './producer-source.js';

export type { ProducerSource };

export type RemoteProducerInfo = {
  producerId: string;
  userId: string;
  kind: 'audio' | 'video';
  source?: ProducerSource;
};

export type ParticipantProducerInfo = {
  producerId: string;
  kind: 'audio' | 'video';
  source?: ProducerSource;
};

export type Peer = {
  userId: string;
  displayName?: string;
  audioMuted?: boolean;
  videoMuted?: boolean;
  raisedHand?: boolean;
  sendTransport?: WebRtcTransport;
  recvTransport?: WebRtcTransport;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
};

export type Room = {
  roomId: string;
  sessionId: string;
  hostUserId: string;
  huddleDbId?: string;
  router: Router;
  workerPid: number;
  peers: Map<string, Peer>;
  peakParticipantCount: number;
  createdAt: Date;
};

const rooms = new Map<string, Room>();
const roomCreateInFlight = new Map<string, Promise<Room>>();

const snapshotForRedis = (room: Room) => ({
  roomId: room.roomId,
  sessionId: room.sessionId,
  hostUserId: room.hostUserId,
  huddleDbId: room.huddleDbId,
  createdAt: room.createdAt.toISOString(),
  peakParticipantCount: room.peakParticipantCount,
  peers: Array.from(room.peers.values()).map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    audioMuted: p.audioMuted ?? false,
    videoMuted: p.videoMuted ?? false,
    raisedHand: p.raisedHand ?? false,
  })),
});

export const getOrCreateRoom = async (
  roomId: string,
  options?: { hostUserId?: string; huddleDbId?: string }
): Promise<Room> => {
  const existing = rooms.get(roomId);
  if (existing) return existing;

  const inFlight = roomCreateInFlight.get(roomId);
  if (inFlight) return inFlight;

  const createPromise = (async (): Promise<Room> => {
    // Re-check after acquiring the single-flight slot (another awaiter may have finished).
    const raced = rooms.get(roomId);
    if (raced) return raced;

    // Try to restore metadata from Redis (e.g. after a restart)
    const persisted = await getPersistedRoom(roomId);

    const worker = getNextWorker();
    const router = await worker.createRouter({ mediaCodecs });

    const room: Room = {
      roomId,
      sessionId: persisted?.sessionId ?? randomUUID(),
      hostUserId: persisted?.hostUserId ?? options?.hostUserId ?? '',
      huddleDbId: persisted?.huddleDbId ?? options?.huddleDbId,
      router,
      workerPid: worker.pid,
      peers: new Map(),
      peakParticipantCount: persisted?.peakParticipantCount ?? 0,
      createdAt: persisted ? new Date(persisted.createdAt) : new Date(),
    };

    rooms.set(roomId, room);
    trackRoomOnWorker(room.workerPid);
    void persistRoom(snapshotForRedis(room));
    return room;
  })().finally(() => {
    roomCreateInFlight.delete(roomId);
  });

  roomCreateInFlight.set(roomId, createPromise);
  return createPromise;
};

export const getRoom = (roomId: string): Room | undefined => rooms.get(roomId);

export const getOrCreatePeer = (room: Room, userId: string, displayName?: string): Peer => {
  let peer = room.peers.get(userId);
  if (!peer) {
    peer = {
      userId,
      displayName,
      audioMuted: false,
      videoMuted: false,
      raisedHand: false,
      producers: new Map(),
      consumers: new Map(),
    };
    room.peers.set(userId, peer);
    room.peakParticipantCount = Math.max(room.peakParticipantCount, room.peers.size);
    if (!room.hostUserId) {
      room.hostUserId = userId;
    }
  } else if (displayName) {
    peer.displayName = displayName;
  }
  void persistRoom(snapshotForRedis(room));
  return peer;
};

export const setPeerMediaState = (
  roomId: string,
  userId: string,
  patch: { audioMuted?: boolean; videoMuted?: boolean; raisedHand?: boolean }
): Peer | undefined => {
  const room = rooms.get(roomId);
  if (!room) return undefined;
  const peer = room.peers.get(userId);
  if (!peer) return undefined;
  if (patch.audioMuted !== undefined) peer.audioMuted = patch.audioMuted;
  if (patch.videoMuted !== undefined) peer.videoMuted = patch.videoMuted;
  if (patch.raisedHand !== undefined) peer.raisedHand = patch.raisedHand;
  void persistRoom(snapshotForRedis(room));
  return peer;
};

export const removePeer = async (roomId: string, userId: string): Promise<{ roomEmptied: boolean }> => {
  const room = rooms.get(roomId);
  if (!room) return { roomEmptied: true };

  const peer = room.peers.get(userId);
  if (!peer) return { roomEmptied: room.peers.size === 0 };

  for (const producer of peer.producers.values()) {
    producer.close();
  }
  for (const consumer of peer.consumers.values()) {
    consumer.close();
  }
  peer.sendTransport?.close();
  peer.recvTransport?.close();
  room.peers.delete(userId);

  // Transfer host if the departing peer was host
  if (room.hostUserId === userId && room.peers.size > 0) {
    const nextHost = room.peers.keys().next().value as string | undefined;
    if (nextHost) room.hostUserId = nextHost;
  }

  void persistRoom(snapshotForRedis(room));

  if (room.peers.size === 0) {
    await closeRoom(roomId);
    return { roomEmptied: true };
  }

  const snapshot = getRoomSnapshot(roomId);
  if (snapshot) {
    const workspaceId = await resolveWorkspaceIdForRoom(roomId);
    if (workspaceId) {
      void emitWorkspaceHuddleUpdate(
        workspaceId,
        buildWorkspaceHuddlePayload(workspaceId, roomId, snapshot)
      );
    }
  }

  return { roomEmptied: false };
};

export const forceCloseRoom = async (roomId: string): Promise<void> => {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const peer of room.peers.values()) {
    for (const producer of peer.producers.values()) producer.close();
    for (const consumer of peer.consumers.values()) consumer.close();
    peer.sendTransport?.close();
    peer.recvTransport?.close();
  }

  await closeRoom(roomId);
};

const closeRoom = async (roomId: string): Promise<void> => {
  const room = rooms.get(roomId);
  if (!room) return;

  const peakCount = Math.max(room.peakParticipantCount, room.peers.size, 1);
  // Lock via DB update (closeRoom can be invoked concurrently from multiple peers).
  const endedCount = await endHuddleSessionRecord(roomId, peakCount);
  const shouldPostChat = endedCount > 0;

  if (shouldPostChat) {
    await createHuddleEndedMessage(roomId, room, peakCount);
  }

  // Always clear live presence when the mediasoup room dies (even if no DB session row).
  const workspaceId = await resolveWorkspaceIdForRoom(roomId);
  if (workspaceId) {
    void emitWorkspaceHuddleUpdate(
      workspaceId,
      buildWorkspaceHuddleInactivePayload(workspaceId, roomId)
    );
  }

  room.router.close();
  rooms.delete(roomId);
  untrackRoomOnWorker(room.workerPid);
  void deletePersistedRoom(roomId);
};

export const listOtherParticipants = (
  room: Room,
  excludeUserId: string
): Array<{
  userId: string;
  displayName?: string;
  audioMuted?: boolean;
  videoMuted?: boolean;
  raisedHand?: boolean;
}> => {
  return Array.from(room.peers.values())
    .filter((p) => p.userId !== excludeUserId)
    .map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
      audioMuted: p.audioMuted,
      videoMuted: p.videoMuted,
      raisedHand: p.raisedHand,
    }));
};

export const listRemoteProducers = (room: Room, excludeUserId: string): RemoteProducerInfo[] => {
  const result: RemoteProducerInfo[] = [];
  for (const [userId, peer] of room.peers) {
    if (userId === excludeUserId) continue;
    for (const producer of peer.producers.values()) {
      result.push({
        producerId: producer.id,
        userId,
        kind: producer.kind,
        ...(producer.kind === 'video'
          ? { source: producerSourceFromProducer(producer) }
          : {}),
      });
    }
  }
  return result;
};

export const getRoomSnapshot = (roomId: string) => {
  const room = rooms.get(roomId);
  if (!room) return null;

  const participants = Array.from(room.peers.values()).map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    audioMuted: p.audioMuted,
    videoMuted: p.videoMuted,
    raisedHand: p.raisedHand,
    producerIds: Array.from(p.producers.keys()),
    producers: Array.from(p.producers.values()).map((producer) => ({
      producerId: producer.id,
      kind: producer.kind,
      ...(producer.kind === 'video'
        ? { source: producerSourceFromProducer(producer) }
        : {}),
    })),
  }));

  return {
    roomId: room.roomId,
    sessionId: room.sessionId,
    hostUserId: room.hostUserId,
    participantCount: room.peers.size,
    participants,
    startedAt: room.createdAt.toISOString(),
  };
};

export const getActiveRoomIds = (): string[] => Array.from(rooms.keys());

/** Force-close all rooms whose router lived on the dead worker pid. */
export const closeRoomsOnWorker = async (workerPid: number): Promise<void> => {
  const affectedRoomIds = Array.from(rooms.values())
    .filter((r) => r.workerPid === workerPid)
    .map((r) => r.roomId);

  if (affectedRoomIds.length === 0) return;
  console.warn(`[rooms] Closing ${affectedRoomIds.length} room(s) on dead worker pid ${workerPid}`);

  await Promise.allSettled(affectedRoomIds.map((id) => forceCloseRoom(id)));
};

// Wire worker-death callback so workers.ts can trigger room cleanup without a circular import.
setOnWorkerDied(closeRoomsOnWorker);

export const findProducerInRoom = (
  room: Room,
  producerId: string
): { producer: Producer; userId: string } | undefined => {
  for (const [userId, peer] of room.peers) {
    const producer = peer.producers.get(producerId);
    if (producer) return { producer, userId };
  }
  return undefined;
};
