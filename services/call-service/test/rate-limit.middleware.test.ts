import { afterEach, describe, expect, it, vi } from 'vitest';
import { relaxedRateLimit, standardRateLimit } from '../src/middleware/rate-limit.middleware.js';

function createRes() {
  const headers: Record<string, unknown> = {};
  const res: any = {
    statusCode: 200,
    body: undefined,
    setHeader(name: string, value: unknown) {
      headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    headers,
  };
  return res;
}

describe('call rate limit middleware', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows the 30th relaxed request and blocks the 31st', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T10:00:00Z'));
    const req: any = { user: { id: 'user-1' }, path: '/stats', ip: '127.0.0.1' };
    const next = vi.fn();

    for (let i = 0; i < 30; i += 1) {
      const res = createRes();
      relaxedRateLimit(req, res, next);
      expect(res.statusCode).toBe(200);
    }

    const blocked = createRes();
    relaxedRateLimit(req, blocked, next);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many requests. Try again shortly.' });
    expect(blocked.headers['RateLimit-Remaining']).toBe(0);
    expect(next).toHaveBeenCalledTimes(30);
  });

  it('starts a new window after 60 seconds and keeps users separate', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T10:00:00Z'));
    const next = vi.fn();
    const req: any = { user: { id: 'user-1' }, path: '/join', ip: '127.0.0.1' };

    for (let i = 0; i < 120; i += 1) standardRateLimit(req, createRes(), next);
    const blocked = createRes();
    standardRateLimit(req, blocked, next);
    expect(blocked.statusCode).toBe(429);

    vi.setSystemTime(new Date('2026-01-05T10:01:01Z'));
    const afterWindow = createRes();
    standardRateLimit(req, afterWindow, next);
    expect(afterWindow.statusCode).toBe(200);

    const other = createRes();
    standardRateLimit({ user: { id: 'user-2' }, path: '/join', ip: '10.0.0.2' } as any, other, next);
    expect(other.statusCode).toBe(200);
  });
});
