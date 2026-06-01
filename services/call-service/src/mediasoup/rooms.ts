import { randomUUID } from 'crypto';
import type {
  Consumer,
  Producer,
  Router,
  WebRtcTransport,
} from 'mediasoup/node/lib/types.js';
import { getNextWorker } from './workers.js';
import { mediaCodecs } from '../config/mediasoup.js';
import { endHuddleSessionRecord } from '../services/huddle-session.service.js';

export type RemoteProducerInfo = {
  producerId: string;
  userId: string;
  kind: 'audio' | 'video';
};

export type Peer = {
  userId: string;
  displayName?: string;
  audioMuted?: boolean;
  videoMuted?: boolean;
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
  peers: Map<string, Peer>;
  peakParticipantCount: number;
  createdAt: Date;
};

const rooms = new Map<string, Room>();

export const getOrCreateRoom = async (
  roomId: string,
  options?: { hostUserId?: string; huddleDbId?: string }
): Promise<Room> => {
  const existing = rooms.get(roomId);
  if (existing) return existing;

  const worker = getNextWorker();
  const router = await worker.createRouter({ mediaCodecs });

  const room: Room = {
    roomId,
    sessionId: randomUUID(),
    hostUserId: options?.hostUserId ?? '',
    huddleDbId: options?.huddleDbId,
    router,
    peers: new Map(),
    peakParticipantCount: 0,
    createdAt: new Date(),
  };

  rooms.set(roomId, room);
  return room;
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
  return peer;
};

export const setPeerMediaState = (
  roomId: string,
  userId: string,
  patch: { audioMuted?: boolean; videoMuted?: boolean }
): Peer | undefined => {
  const room = rooms.get(roomId);
  const peer = room?.peers.get(userId);
  if (!peer) return undefined;
  if (patch.audioMuted !== undefined) peer.audioMuted = patch.audioMuted;
  if (patch.videoMuted !== undefined) peer.videoMuted = patch.videoMuted;
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

  if (room.peers.size === 0) {
    await closeRoom(roomId);
    return { roomEmptied: true };
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
  room.router.close();
  rooms.delete(roomId);
  await endHuddleSessionRecord(roomId, peakCount);
};

export const listOtherParticipants = (
  room: Room,
  excludeUserId: string
): Array<{ userId: string; displayName?: string; audioMuted?: boolean; videoMuted?: boolean }> => {
  return Array.from(room.peers.values())
    .filter((p) => p.userId !== excludeUserId)
    .map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
      audioMuted: p.audioMuted,
      videoMuted: p.videoMuted,
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
    producerIds: Array.from(p.producers.keys()),
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
