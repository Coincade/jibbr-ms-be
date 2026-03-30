import request from 'supertest';
import { createAuthApp } from '../app.js';

describe('auth-service e2e', () => {
  it('returns health information without requiring the database', async () => {
    const app = createAuthApp({
      isDbConnected: () => false,
    });

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'healthy',
      service: 'auth-service',
      dbConnected: false,
    });
    expect(response.body.timestamp).toEqual(expect.any(String));
  });

  it('returns 503 for API requests when the database is unavailable', async () => {
    const app = createAuthApp({
      isDbConnected: () => false,
    });

    const response = await request(app).get('/api/blocked');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      message: 'Database unavailable. Please try again in a moment.',
      status: 503,
    });
  });
});
