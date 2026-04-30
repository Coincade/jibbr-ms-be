import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const snapshot = vi.hoisted(() => vi.fn(() => ({ ok: 1 })));
vi.mock('../src/services/realtime-observability.service.js', () => ({
  realtimeMetrics: { snapshot },
}));

import { createSocketApp } from '../src/app.js';

describe('socket app', () => {
  it('returns health payload', async () => {
    const app = createSocketApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'healthy',
        service: 'socket-service',
      })
    );
  });

  it('returns realtime health payload', async () => {
    const app = createSocketApp();
    const res = await request(app).get('/health/realtime');
    expect(res.status).toBe(200);
    expect(res.body.realtimeMetrics).toEqual({ ok: 1 });
  });
});
