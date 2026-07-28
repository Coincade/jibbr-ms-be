import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('call-signal.service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.INTERNAL_SERVICE_SECRET = 'secret-1';
    process.env.SOCKET_SERVICE_INTERNAL_URL = 'http://socket.internal';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...ORIGINAL_ENV };
  });

  it('retries transient failures and succeeds on a later attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { emitCallRoomSignal, getCallSignalMetrics } = await import('../src/services/call-signal.service.js');

    const pending = emitCallRoomSignal('room-1', 'channel_call_started', { foo: 'bar' });
    await vi.runAllTimersAsync();
    await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://socket.internal/internal/call/broadcast',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Internal-Secret': 'secret-1' }),
      })
    );
    expect(getCallSignalMetrics()).toMatchObject({
      attempts: 1,
      successes: 1,
      failures: 0,
    });
  });

  it('routes conversation rooms using conversationId instead of channelId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { emitWorkspaceHuddleUpdate } = await import('../src/services/call-signal.service.js');
    await emitWorkspaceHuddleUpdate('workspace-1', { roomId: 'conv:dm-1' });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://socket.internal/internal/call/broadcast',
      expect.any(Object)
    );
    expect(body.conversationId).toBe('dm-1');
    expect(body.channelId).toBeUndefined();
  });

  it('tracks skipped metrics and warns once when internal config is missing', async () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn());

    const { emitCallRoomSignal, getCallSignalMetrics } = await import('../src/services/call-signal.service.js');

    await emitCallRoomSignal('room-1', 'event-a', {});
    await emitCallRoomSignal('room-1', 'event-b', {});

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(getCallSignalMetrics()).toMatchObject({
      attempts: 0,
      successes: 0,
      failures: 0,
      skippedNoConfig: 2,
    });
  });
});
