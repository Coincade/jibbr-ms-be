import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

vi.mock('../src/config/redis.js', () => ({
  getRedisHealth: vi.fn(),
}));

vi.mock('../src/mediasoup/rooms.js', () => ({
  getActiveRoomIds: vi.fn(),
}));

vi.mock('../src/mediasoup/workers.js', () => ({
  getMediasoupWorkerStats: vi.fn(),
}));

vi.mock('../src/services/call-signal.service.js', () => ({
  getCallSignalMetrics: vi.fn(),
}));

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
  vi.clearAllMocks();
});

describe('getCallServiceHealth', () => {
  it('returns degraded with warnings when NAT config is required but missing', async () => {
    process.env.CALL_REQUIRE_NAT_CONFIG = '1';
    delete process.env.MEDIASOUP_ANNOUNCED_IP;
    delete process.env.TURN_URL;
    delete process.env.TURN_USERNAME;
    delete process.env.TURN_CREDENTIAL;

    const redis = await import('../src/config/redis.js');
    const rooms = await import('../src/mediasoup/rooms.js');
    const workers = await import('../src/mediasoup/workers.js');
    const callSignal = await import('../src/services/call-signal.service.js');

    vi.mocked(redis.getRedisHealth).mockReturnValue({ configured: false, connected: false });
    vi.mocked(rooms.getActiveRoomIds).mockReturnValue([]);
    vi.mocked(workers.getMediasoupWorkerStats).mockReturnValue({
      expected: 1,
      running: 1,
      pids: [101],
      roomsByWorker: { '101': 0 },
    });
    vi.mocked(callSignal.getCallSignalMetrics).mockReturnValue({
      attempts: 0,
      successes: 0,
      failures: 0,
      skippedNoConfig: 1,
    });

    const { getCallServiceHealth } = await import('../src/services/health.service.js');
    const health = getCallServiceHealth();

    expect(health.status).toBe('degraded');
    expect(health.turnConfigured).toBe(false);
    expect(health.announcedIpConfigured).toBe(false);
    expect(health.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('TURN is not configured'),
        expect.stringContaining('MEDIASOUP_ANNOUNCED_IP is not set'),
        expect.stringContaining('huddle socket fan-out skipped'),
      ])
    );
  });

  it('returns unhealthy when active rooms exist but no mediasoup workers are running', async () => {
    process.env.MEDIASOUP_ANNOUNCED_IP = '203.0.113.10';
    process.env.TURN_URL = 'turn:turn.example.com:3478';
    process.env.TURN_USERNAME = 'alice';
    process.env.TURN_CREDENTIAL = 'secret';

    const redis = await import('../src/config/redis.js');
    const rooms = await import('../src/mediasoup/rooms.js');
    const workers = await import('../src/mediasoup/workers.js');
    const callSignal = await import('../src/services/call-signal.service.js');

    vi.mocked(redis.getRedisHealth).mockReturnValue({ configured: true, connected: true });
    vi.mocked(rooms.getActiveRoomIds).mockReturnValue(['room-1']);
    vi.mocked(workers.getMediasoupWorkerStats).mockReturnValue({
      expected: 2,
      running: 0,
      pids: [],
      roomsByWorker: {},
    });
    vi.mocked(callSignal.getCallSignalMetrics).mockReturnValue({
      attempts: 2,
      successes: 2,
      failures: 0,
      skippedNoConfig: 0,
    });

    const { getCallServiceHealth } = await import('../src/services/health.service.js');
    const health = getCallServiceHealth();

    expect(health.status).toBe('unhealthy');
    expect(health.activeRooms).toBe(1);
    expect(health.mediasoupWorkers.running).toBe(0);
    expect(health.warnings).toEqual([]);
  });
});
