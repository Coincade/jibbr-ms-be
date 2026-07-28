import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const capturedOptions: { current: any } = { current: null };
const verifyMock = vi.fn();

vi.mock('express-rate-limit', () => ({
  default: vi.fn((options: any) => {
    capturedOptions.current = options;
    return vi.fn();
  }),
}));

vi.mock('jsonwebtoken', () => ({
  default: { verify: verifyMock },
}));

describe('createJwtOrIpRateLimiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOptions.current = null;
    delete process.env.JWT_SECRET;
    delete process.env.RATE_LIMIT_WINDOW_MS;
    delete process.env.RATE_LIMIT_MAX;
  });

  it('uses the verified JWT user id as the rate-limit key', async () => {
    process.env.JWT_SECRET = 'secret-1';
    verifyMock.mockReturnValue({ id: 'user-1' });

    const { createJwtOrIpRateLimiter } = await import('../src/index.js');
    createJwtOrIpRateLimiter();

    const req = {
      headers: { authorization: 'Bearer token-1' },
      ip: '127.0.0.1',
      path: '/api/messages',
    } as Request;

    expect(capturedOptions.current.keyGenerator(req, {} as Response)).toBe('user:user-1');
  });

  it('falls back to the IP when token verification fails', async () => {
    process.env.JWT_SECRET = 'secret-1';
    verifyMock.mockImplementation(() => {
      throw new Error('expired');
    });

    const { createJwtOrIpRateLimiter } = await import('../src/index.js');
    createJwtOrIpRateLimiter();

    const req = {
      headers: { authorization: 'Bearer bad-token' },
      ip: '10.0.0.5',
      path: '/api/messages',
    } as Request;

    expect(capturedOptions.current.keyGenerator(req, {} as Response)).toBe('ip:10.0.0.5');
  });

  it('always skips /health and respects env-based limits', async () => {
    process.env.RATE_LIMIT_WINDOW_MS = '120000';
    process.env.RATE_LIMIT_MAX = '55';

    const { createJwtOrIpRateLimiter } = await import('../src/index.js');
    createJwtOrIpRateLimiter({
      skip: () => false,
    });

    expect(capturedOptions.current.windowMs).toBe(120000);
    expect(capturedOptions.current.limit).toBe(55);
    expect(capturedOptions.current.skip({ path: '/health' } as Request, {} as Response)).toBe(true);
  });
});
