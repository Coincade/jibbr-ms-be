import { beforeEach, describe, expect, it, vi } from 'vitest';

const increment = vi.hoisted(() => vi.fn());
const getStateRedisClient = vi.hoisted(() => vi.fn());

vi.mock('../src/services/realtime-observability.service.js', () => ({
  realtimeMetrics: { increment },
}));
vi.mock('../src/config/redis.js', () => ({ getStateRedisClient }));

import {
  checkSocketEventRateLimit,
  checkSocketEventRateLimitDistributed,
} from '../src/services/socket-event-rate-limiter.service.js';

describe('socket event rate limiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('in-memory limiter blocks when exceeding limit', () => {
    expect(checkSocketEventRateLimit('u1', 'message')).toBe(true);
    for (let i = 0; i < 60; i += 1) checkSocketEventRateLimit('u1', 'message');
    expect(checkSocketEventRateLimit('u1', 'message')).toBe(false);
  });

  it('distributed limiter allows under redis threshold', async () => {
    getStateRedisClient.mockResolvedValue({
      incr: vi.fn(async () => 1),
      pExpire: vi.fn(async () => undefined),
    });
    await expect(checkSocketEventRateLimitDistributed('u1', 'typing')).resolves.toBe(true);
  });

  it('distributed limiter falls back to in-memory on redis error', async () => {
    getStateRedisClient.mockRejectedValue(new Error('redis down'));
    await expect(checkSocketEventRateLimitDistributed('u1', 'presence')).resolves.toBe(true);
    expect(increment).toHaveBeenCalledWith('rate_limit.redis_error');
  });
});
