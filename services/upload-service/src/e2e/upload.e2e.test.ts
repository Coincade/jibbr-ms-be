import request from 'supertest';
import { createUploadApp } from '../app.js';

describe('upload-service e2e', () => {
  it('returns service health data', async () => {
    const app = createUploadApp();

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'healthy',
      service: 'upload-service',
    });
    expect(response.body.timestamp).toEqual(expect.any(String));
  });

  it('rejects unauthenticated upload progress requests', async () => {
    const app = createUploadApp();

    const response = await request(app).get('/api/upload/progress/upload-123');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      status: 401,
      message: 'Unauthorized',
    });
  });
});
