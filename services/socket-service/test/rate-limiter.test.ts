import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('services/rate-limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads env-backed config with fallback', async () => {
    process.env.RATE_LIMIT_MAX = '120';
    process.env.RATE_LIMIT_WINDOW_MS = '90000';
    const mod = await import('../src/services/rate-limiter.js');
    expect(mod.getSocketMessageRateLimitConfig()).toEqual({ maxMessages: 120, windowMs: 90000 });
  });

  it('blocks after max reached in window', async () => {
    const mod = await import('../src/services/rate-limiter.js');
    expect(mod.checkMessageRateLimit('u1', 2, 60000)).toBe(true);
    expect(mod.checkMessageRateLimit('u1', 2, 60000)).toBe(true);
    expect(mod.checkMessageRateLimit('u1', 2, 60000)).toBe(false);
  });
});
