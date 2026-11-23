import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisClient = vi.hoisted(() => ({
  get: vi.fn(),
  ttl: vi.fn(),
  decr: vi.fn(),
  expire: vi.fn(),
  del: vi.fn(),
  multi: vi.fn(),
}));

const createStateRedisClient = vi.hoisted(() => vi.fn(async () => redisClient));

vi.mock('../src/config/redis.js', () => ({
  createStateRedisClient,
}));

describe('libs/rateLimiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    createStateRedisClient.mockResolvedValue(redisClient);
    redisClient.multi.mockReturnValue({
      decr: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn(async () => []),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('allows the mention when redis is unavailable', async () => {
    createStateRedisClient.mockRejectedValue(new Error('down'));
    const { checkSpecialMentionRateLimit } = await import('../src/libs/rateLimiter.js');
    const result = await checkSpecialMentionRateLimit('u1:c1', 1, 120);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it('consumes a token and can reset the key', async () => {
    redisClient.get.mockResolvedValue(null);
    const { checkSpecialMentionRateLimit, resetRateLimit } = await import('../src/libs/rateLimiter.js');
    const result = await checkSpecialMentionRateLimit('u1:c1', 2, 120);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
    expect(redisClient.multi).toHaveBeenCalled();

    await resetRateLimit('u1:c1');
    expect(redisClient.del).toHaveBeenCalledWith('mention:rate_limit:u1:c1');
  });

  it('blocks when the bucket is empty', async () => {
    redisClient.get.mockResolvedValue('0');
    redisClient.ttl.mockResolvedValue(30);
    const { checkSpecialMentionRateLimit } = await import('../src/libs/rateLimiter.js');
    const result = await checkSpecialMentionRateLimit('u1:c1', 1, 120);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});
