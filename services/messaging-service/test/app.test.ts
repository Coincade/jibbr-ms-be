import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/config/rateLimit.js', () => {
  return {
    appLimiter: (_req: any, _res: any, next: any) => next(),
    readHeavyLimiter: (_req: any, _res: any, next: any) => next(),
    isReadHeavyRequest: () => false,
  };
});

import { createMessagingApp } from '../src/app.js';

describe('Messaging App (app.ts)', () => {
  it('GET /health returns healthy payload (default dbConnected=true)', async () => {
    const app = createMessagingApp();

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'healthy',
      service: 'messaging-service',
      dbConnected: true,
    });
    expect(res.body.timestamp).toEqual(expect.any(String));
    expect(res.body.uptime).toEqual(expect.any(Number));
    expect(res.body.memory).toEqual(expect.any(String));
  });

  it('GET /health bypasses db-unavailable middleware', async () => {
    const app = createMessagingApp({
      isDbConnected: () => false,
    });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'healthy',
      service: 'messaging-service',
      dbConnected: false,
    });
  });

  it('returns 503 for non-health routes when db is unavailable', async () => {
    const app = createMessagingApp({
      isDbConnected: () => false,
    });

    const res = await request(app).get('/api/blocked');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      message: 'Database unavailable. Please try again in a moment.',
      status: 503,
    });
  });

  it('passes db middleware for non-health routes when db is available', async () => {
    const app = createMessagingApp({
      isDbConnected: () => true,
    });

    const res = await request(app).get('/api/open');

    // Route does not exist, but middleware should pass through (not 503).
    expect(res.status).toBe(404);
  });
});
