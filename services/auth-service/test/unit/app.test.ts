import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/rateLimit.js', () => {
  return {
    appLimiter: (_req: any, _res: any, next: any) => next(),
  };
});

import { createAuthApp } from '../../src/app.js';


describe('Auth App (App.ts)', () => {
  it('GET /health returns healthy payload (default dbConnected=true)', async () => {
    const app = createAuthApp();

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'healthy',
      service: 'auth-service',
      dbConnected: true,
    });
    expect(res.body.timestamp).toEqual(expect.any(String));
    expect(res.body.uptime).toEqual(expect.any(Number));
    expect(res.body.memory).toEqual(expect.any(String));
  });

  it('GET /health bypasses db-unavailable middleware', async () => {
    const app = createAuthApp({
      isDbConnected: () => false,
    });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'healthy',
      service: 'auth-service',
      dbConnected: false,
    });
  });

  it('returns 503 for non-health routes when db is unavailable', async () => {
    const app = createAuthApp({
      isDbConnected: () => false,
    });

    const res = await request(app).get('/api/blocked');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      message: 'Database unavailable. Please try again in a moment.',
      status: 503,
    });
  });

  it('sets view engine and views when viewsPath is provided', () => {
    const app = createAuthApp({
      viewsPath: 'C:\\tmp\\views',
    });

    expect(app.get('view engine')).toBe('ejs');
    expect(app.get('views')).toBe('C:\\tmp\\views');
  });
});

