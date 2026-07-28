import request from 'supertest';

process.env.DATABASE_URL ||=
  'postgresql://jibbr:jibbr_password@localhost:5432/jibbr_test';

describe('socket-service e2e', () => {
  it('returns service health data', async () => {
    const { createSocketApp } = await import('../app.js');
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
    const { createSocketApp } = await import('../app.js');
    const app = createSocketApp();

    const response = await request(app).get('/api/unknown');

    expect(response.status).toBe(404);
  });
});
