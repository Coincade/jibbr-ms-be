import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('call-kick.service host-check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      INTERNAL_SERVICE_SECRET: 'secret-1',
      CALL_SERVICE_URL: 'http://call.internal',
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it('returns host status from call-service', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        active: true,
        hostUserId: 'host-1',
        isHost: false,
        participantCount: 2,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchCallRoomHostStatus } = await import('../src/services/call-kick.service.js');
    const status = await fetchCallRoomHostStatus({ userId: 'u2', channelId: 'ch-1' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://call.internal/internal/call/host-check',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Internal-Secret': 'secret-1' }),
      })
    );
    expect(status).toEqual({
      active: true,
      hostUserId: 'host-1',
      isHost: false,
      participantCount: 2,
    });
  });

  it('returns null when call-service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { fetchCallRoomHostStatus } = await import('../src/services/call-kick.service.js');
    await expect(
      fetchCallRoomHostStatus({ userId: 'u1', conversationId: 'dm-1' })
    ).resolves.toBeNull();

    expect(warnSpy).toHaveBeenCalled();
  });
});
