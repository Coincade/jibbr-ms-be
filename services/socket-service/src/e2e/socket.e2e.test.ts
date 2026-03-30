import request from 'supertest';
import { createSocketApp } from '../app.js';

describe('socket-service e2e', () => {
  it('returns service health data', async () => {
    const app = createSocketApp();

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'healthy',
      service: 'socket-service',
    });
    expect(response.body.timestamp).toEqual(expect.any(String));
  });

  it('returns 404 for unknown routes', async () => {
    const app = createSocketApp();

    const response = await request(app).get('/api/unknown');

    expect(response.status).toBe(404);
  });
});
