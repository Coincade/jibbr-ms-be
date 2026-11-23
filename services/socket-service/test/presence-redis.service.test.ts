import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisClient = vi.hoisted(() => ({
  incr: vi.fn(),
  expire: vi.fn(),
  sAdd: vi.fn(),
  exists: vi.fn(),
  decr: vi.fn(),
  del: vi.fn(),
  sRem: vi.fn(),
  sMembers: vi.fn(),
}));

const getStateRedisClient = vi.hoisted(() => vi.fn(async () => redisClient));

vi.mock('../src/config/redis.js', () => ({
  getStateRedisClient,
}));

describe('presence-redis.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getStateRedisClient.mockResolvedValue(redisClient);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('marks a user online and refreshes the connection ttl', async () => {
    redisClient.incr.mockResolvedValue(1);
    const { redisPresenceOnline } = await import('../src/services/presence-redis.service.js');
    await redisPresenceOnline('u1');
    expect(redisClient.incr).toHaveBeenCalledWith('presence:conn:u1');
    expect(redisClient.expire).toHaveBeenCalledWith('presence:conn:u1', 90);
    expect(redisClient.sAdd).toHaveBeenCalledWith('presence:online', 'u1');
  });

  it('heartbeats only when the connection key exists', async () => {
    redisClient.exists.mockResolvedValue(0);
    const { redisPresenceHeartbeat } = await import('../src/services/presence-redis.service.js');
    await redisPresenceHeartbeat('u1');
    expect(redisClient.expire).not.toHaveBeenCalled();
  });

  it('removes the user from the online set when the last connection drops', async () => {
    redisClient.decr.mockResolvedValue(0);
    const { redisPresenceOffline } = await import('../src/services/presence-redis.service.js');
    await expect(redisPresenceOffline('u1')).resolves.toBe(false);
    expect(redisClient.del).toHaveBeenCalledWith('presence:conn:u1');
    expect(redisClient.sRem).toHaveBeenCalledWith('presence:online', 'u1');
  });

  it('returns fallbacks when redis throws', async () => {
    getStateRedisClient.mockRejectedValue(new Error('down'));
    const { redisIsUserOnline, redisGetOnlineUsers } = await import(
      '../src/services/presence-redis.service.js'
    );
    await expect(redisIsUserOnline('u1')).resolves.toBe(false);
    await expect(redisGetOnlineUsers()).resolves.toEqual([]);
  });
});
