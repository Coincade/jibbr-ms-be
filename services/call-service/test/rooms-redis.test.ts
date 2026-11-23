import { beforeEach, describe, expect, it, vi } from 'vitest';

const redis = vi.hoisted(() => ({
  set: vi.fn(),
  del: vi.fn(),
  get: vi.fn(),
  keys: vi.fn(),
  mget: vi.fn(),
}));

const getRedisClient = vi.hoisted(() => vi.fn(() => redis));

vi.mock('../src/config/redis.js', () => ({
  getRedisClient,
}));

import {
  deletePersistedRoom,
  getAllPersistedRooms,
  getPersistedRoom,
  persistRoom,
  type PersistedRoom,
} from '../src/mediasoup/rooms-redis.js';

const room: PersistedRoom = {
  roomId: 'room-1',
  sessionId: 'sess-1',
  hostUserId: 'user-1',
  createdAt: '2026-01-05T10:00:00.000Z',
  peakParticipantCount: 2,
  peers: [],
};

describe('rooms-redis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRedisClient.mockReturnValue(redis);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('writes, reads, and deletes a room', async () => {
    redis.get.mockResolvedValue(JSON.stringify(room));

    await persistRoom(room);
    await expect(getPersistedRoom('room-1')).resolves.toEqual(room);
    await deletePersistedRoom('room-1');

    expect(redis.set).toHaveBeenCalledWith('call:room:room-1', JSON.stringify(room), 'EX', 60 * 60 * 3);
    expect(redis.del).toHaveBeenCalledWith('call:room:room-1');
  });

  it('lists every persisted room', async () => {
    redis.keys.mockResolvedValue(['call:room:room-1']);
    redis.mget.mockResolvedValue([JSON.stringify(room)]);

    await expect(getAllPersistedRooms()).resolves.toEqual([room]);
  });

  it('returns an empty list when redis is not configured', async () => {
    getRedisClient.mockReturnValue(null);
    await expect(getAllPersistedRooms()).resolves.toEqual([]);
    await expect(getPersistedRoom('room-1')).resolves.toBeNull();
    await persistRoom(room);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('swallows redis errors and returns the fallback', async () => {
    redis.keys.mockRejectedValue(new Error('down'));
    redis.get.mockRejectedValue(new Error('down'));

    await expect(getAllPersistedRooms()).resolves.toEqual([]);
    await expect(getPersistedRoom('room-1')).resolves.toBeNull();
  });
});
