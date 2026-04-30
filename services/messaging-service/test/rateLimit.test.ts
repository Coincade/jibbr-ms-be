import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@jibbr/rate-limit');
  delete process.env.RATE_LIMIT_READ_WINDOW_MS;
  delete process.env.RATE_LIMIT_WINDOW_MS;
  delete process.env.RATE_LIMIT_READ_MAX;
  delete process.env.COLLAB_SEARCH_RATE_LIMIT_WINDOW_MS;
  delete process.env.COLLAB_SEARCH_RATE_LIMIT_MAX;
});

describe('config/rateLimit', () => {
  it('identifies read-heavy routes for GET requests only', async () => {
    const { isReadHeavyRequest } = await import('../src/config/rateLimit.js');

    const readReq = { method: 'GET', path: '/api/conversations' } as Request;
    const writeReq = { method: 'POST', path: '/api/conversations' } as Request;
    const unknownReq = { method: 'GET', path: '/api/messages' } as Request;

    expect(isReadHeavyRequest(readReq)).toBe(true);
    expect(isReadHeavyRequest(writeReq)).toBe(false);
    expect(isReadHeavyRequest(unknownReq)).toBe(false);
  });

  it('creates limiters with expected default options', async () => {
    const createLimiter = vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next());
    vi.doMock('@jibbr/rate-limit', () => ({
      createJwtOrIpRateLimiter: createLimiter,
    }));

    await import('../src/config/rateLimit.js');

    expect(createLimiter).toHaveBeenNthCalledWith(1);
    expect(createLimiter).toHaveBeenNthCalledWith(2, {
      windowMs: 60000,
      limit: 400,
    });
    expect(createLimiter).toHaveBeenNthCalledWith(3, {
      windowMs: 60000,
      limit: 40,
      message: 'Too many collaborator searches. Please wait a moment and try again.',
    });
  });
});
