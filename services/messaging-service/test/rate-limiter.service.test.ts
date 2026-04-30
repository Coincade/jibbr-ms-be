import { beforeEach, describe, expect, it, vi } from 'vitest';

const redis = vi.hoisted(() => ({
  get: vi.fn(),
  ttl: vi.fn(),
  del: vi.fn(),
  multi: vi.fn(),
}));
const createStateRedisClient = vi.hoisted(() => vi.fn());

vi.mock('../src/config/redis.js', () => ({ createStateRedisClient }));

import { checkSpecialMentionRateLimit, resetRateLimit } from '../src/libs/rateLimiter.js';

describe('rate-limiter service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows request when redis client is unavailable', async () => {
    createStateRedisClient.mockRejectedValue(new Error('redis down'));
    const result = await checkSpecialMentionRateLimit('u1:c1', 2, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it('blocks request when tokens are depleted', async () => {
    redis.get.mockResolvedValue('0');
    redis.ttl.mockResolvedValue(5);
    createStateRedisClient.mockResolvedValue(redis);

    const result = await checkSpecialMentionRateLimit('u1:c1', 1, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('consumes token when available', async () => {
    const exec = vi.fn().mockResolvedValue([]);
    redis.get.mockResolvedValue('2');
    redis.multi.mockReturnValue({ decr: vi.fn(), expire: vi.fn(), exec });
    createStateRedisClient.mockResolvedValue(redis);

    const result = await checkSpecialMentionRateLimit('u1:c1', 2, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
    expect(exec).toHaveBeenCalled();
  });

  it('resetRateLimit deletes redis key', async () => {
    createStateRedisClient.mockResolvedValue(redis);
    await resetRateLimit('u1:c1');
    expect(redis.del).toHaveBeenCalledWith('mention:rate_limit:u1:c1');
  });
});
