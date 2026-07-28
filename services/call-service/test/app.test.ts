import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/routes/call.route.js', async () => {
  const express = await import('express');
  return { default: express.Router() };
});

vi.mock('../src/services/health.service.js', () => ({
  getCallServiceHealth: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('createCallApp', () => {
  it('returns 503 when the health service reports unhealthy', async () => {
    const { getCallServiceHealth } = await import('../src/services/health.service.js');
    vi.mocked(getCallServiceHealth).mockReturnValue({
      status: 'unhealthy',
      service: 'call-service',
      uptime: 12,
      activeRooms: 1,
      mediasoupWorkers: { expected: 1, running: 0, pids: [], roomsByWorker: {} },
      redis: { configured: true, connected: false },
      turnConfigured: false,
      announcedIpConfigured: false,
      warnings: ['worker pool unavailable'],
      callSignal: { attempts: 1, successes: 0, failures: 1, skippedNoConfig: 0 },
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    const { createCallApp } = await import('../src/app.js');
    const response = await request(createCallApp()).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unhealthy');
    expect(response.body.service).toBe('call-service');
  });

  it('returns 200 for degraded health responses', async () => {
    const { getCallServiceHealth } = await import('../src/services/health.service.js');
    vi.mocked(getCallServiceHealth).mockReturnValue({
      status: 'degraded',
      service: 'call-service',
      uptime: 30,
      activeRooms: 0,
      mediasoupWorkers: { expected: 1, running: 1, pids: [456], roomsByWorker: { '456': 0 } },
      redis: { configured: false, connected: false },
      turnConfigured: false,
      announcedIpConfigured: true,
      warnings: ['TURN is not configured'],
      callSignal: { attempts: 0, successes: 0, failures: 0, skippedNoConfig: 0 },
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    const { createCallApp } = await import('../src/app.js');
    const response = await request(createCallApp()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('degraded');
  });
});
