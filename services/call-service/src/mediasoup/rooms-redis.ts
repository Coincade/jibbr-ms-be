/**
 * Persists lightweight room metadata to Redis so peers can seamlessly rejoin
 * after a call-service restart/redeploy. Mediasoup transports are in-process
 * objects that cannot be migrated — participants still need to re-create
 * transports, but the same session ID and host are preserved.
 */
import { getRedisClient } from '../config/redis.js';

const ROOM_TTL_SECONDS = 60 * 60 * 3; // 3 hours (long enough for any realistic call)
const KEY_PREFIX = 'call:room:';

export type PersistedRoom = {
  roomId: string;
  sessionId: string;
  hostUserId: string;
  huddleDbId?: string;
  createdAt: string;
  peakParticipantCount: number;
  peers: Array<{
    userId: string;
    displayName?: string;
    audioMuted: boolean;
    videoMuted: boolean;
  }>;
};

const key = (roomId: string) => `${KEY_PREFIX}${roomId}`;

export const persistRoom = async (room: PersistedRoom): Promise<void> => {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.set(key(room.roomId), JSON.stringify(room), 'EX', ROOM_TTL_SECONDS);
  } catch (e) {
    console.error('[rooms-redis] Failed to persist room:', e);
  }
};

export const deletePersistedRoom = async (roomId: string): Promise<void> => {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.del(key(roomId));
  } catch (e) {
    console.error('[rooms-redis] Failed to delete room:', e);
  }
};

export const getPersistedRoom = async (roomId: string): Promise<PersistedRoom | null> => {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(key(roomId));
    if (!raw) return null;
    return JSON.parse(raw) as PersistedRoom;
  } catch (e) {
    console.error('[rooms-redis] Failed to get room:', e);
    return null;
  }
};

export const getAllPersistedRooms = async (): Promise<PersistedRoom[]> => {
  const redis = getRedisClient();
  if (!redis) return [];
  try {
    const keys = await redis.keys(`${KEY_PREFIX}*`);
    if (keys.length === 0) return [];
    const values = await redis.mget(...keys);
    return values
      .filter((v): v is string => v !== null)
      .map((v) => JSON.parse(v) as PersistedRoom);
  } catch (e) {
    console.error('[rooms-redis] Failed to list rooms:', e);
    return [];
  }
};
