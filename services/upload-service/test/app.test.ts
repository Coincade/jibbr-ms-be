import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@jibbr/rate-limit', () => ({
  createJwtOrIpRateLimiter: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));
vi.mock('../src/routes/upload.route.js', () => ({
  default: (_req: any, _res: any, next: any) => next(),
}));

import { createUploadApp } from '../src/app.js';

describe('upload app', () => {
  it('health endpoint returns service metadata', async () => {
    const res = await request(createUploadApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'healthy', service: 'upload-service' });
  });
});
