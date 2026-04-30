import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('services/rate-limiter (in-memory)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks when user exceeds max messages in window', async () => {
    const { checkMessageRateLimit } = await import('../src/services/rate-limiter.js');
    expect(checkMessageRateLimit('u1', 2, 60000)).toBe(true);
    expect(checkMessageRateLimit('u1', 2, 60000)).toBe(true);
    expect(checkMessageRateLimit('u1', 2, 60000)).toBe(false);
  });

  it('resets user window after expiry', async () => {
    const { checkMessageRateLimit } = await import('../src/services/rate-limiter.js');
    expect(checkMessageRateLimit('u1', 1, 1000)).toBe(true);
    expect(checkMessageRateLimit('u1', 1, 1000)).toBe(false);

    vi.advanceTimersByTime(1500);
    vi.setSystemTime(new Date('2026-01-01T00:00:01.500Z'));

    expect(checkMessageRateLimit('u1', 1, 1000)).toBe(true);
  });

  it('cleanup interval runs and removes expired entries', async () => {
    const { checkMessageRateLimit } = await import('../src/services/rate-limiter.js');
    expect(checkMessageRateLimit('u-clean', 1, 1000)).toBe(true);
    vi.advanceTimersByTime(1100);
    vi.setSystemTime(new Date('2026-01-01T00:00:01.100Z'));
    vi.advanceTimersByTime(60000); // triggers cleanup interval

    expect(checkMessageRateLimit('u-clean', 1, 1000)).toBe(true);
  });
});
