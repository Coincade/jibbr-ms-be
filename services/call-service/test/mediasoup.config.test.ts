import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('mediasoup config helpers', () => {
  it('treats quoted TURN env vars as configured', async () => {
    process.env.TURN_URL = '"turn:turn.example.com:3478"';
    process.env.TURN_USERNAME = "'alice'";
    process.env.TURN_CREDENTIAL = '"secret"';

    const { isTurnConfigured, getIceServers } = await import('../src/config/mediasoup.js');

    expect(isTurnConfigured()).toBe(true);
    expect(getIceServers()).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: 'turn:turn.example.com:3478',
        username: 'alice',
        credential: 'secret',
      },
    ]);
  });

  it('includes announced IP only when present', async () => {
    process.env.MEDIASOUP_LISTEN_IP = '10.0.0.5';
    process.env.MEDIASOUP_ANNOUNCED_IP = '203.0.113.10';

    const { getWebRtcTransportOptions } = await import('../src/config/mediasoup.js');

    expect(getWebRtcTransportOptions()).toMatchObject({
      listenIps: [{ ip: '10.0.0.5', announcedIp: '203.0.113.10' }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });
  });
});
