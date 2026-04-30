import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  $executeRawUnsafe: vi.fn(),
  $queryRawUnsafe: vi.fn(),
}));

const publishChannelMembershipUpdatedEventNow = vi.hoisted(() => vi.fn());
const publishConversationMembershipUpdatedEventNow = vi.hoisted(() => vi.fn());
const randomUUID = vi.hoisted(() => vi.fn(() => 'outbox-id-1'));

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('../src/services/streams-publisher.service.js', () => ({
  publishChannelMembershipUpdatedEventNow,
  publishConversationMembershipUpdatedEventNow,
}));
vi.mock('crypto', () => ({ randomUUID }));

describe('membership-outbox.service', () => {
  const flushAsyncWork = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const eventually = async (check: () => boolean) => {
    for (let i = 0; i < 20; i += 1) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('condition not met');
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('initializes outbox table and index', async () => {
    const svc = await import('../src/services/membership-outbox.service.js');
    await svc.initMembershipOutbox();

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRawUnsafe.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS event_outbox');
    expect(prisma.$executeRawUnsafe.mock.calls[1][0]).toContain('CREATE INDEX IF NOT EXISTS idx_event_outbox_status_available');
  });

  it('enqueues outbox event with generated id', async () => {
    const svc = await import('../src/services/membership-outbox.service.js');
    const tx = { $executeRawUnsafe: vi.fn() };

    await svc.enqueueMembershipOutboxEvent(tx as never, 'membership.channel.updated', {
      userId: 'u1',
      action: 'add',
      channelId: 'c1',
    });

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO event_outbox'),
      'outbox-id-1',
      'membership.channel.updated',
      JSON.stringify({ userId: 'u1', action: 'add', channelId: 'c1' })
    );
  });

  it('relay publishes pending events and marks success', async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: 'e1',
        event_type: 'membership.channel.updated',
        payload: { userId: 'u1', action: 'add', channelId: 'c1' },
        attempts: 0,
      },
    ]);

    let poll: (() => void) | undefined;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((cb: () => void) => {
      poll = cb;
      return 1 as never;
    }) as never);

    const svc = await import('../src/services/membership-outbox.service.js');
    svc.startMembershipOutboxRelay();
    poll?.();
    await flushAsyncWork();

    expect(publishChannelMembershipUpdatedEventNow).toHaveBeenCalledWith({
      userId: 'u1',
      channelId: 'c1',
      action: 'add',
    });
    await eventually(() =>
      prisma.$executeRawUnsafe.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].includes("SET status='SENT'") && call[1] === 'e1'
      )
    );
    expect(
      prisma.$executeRawUnsafe.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].includes("SET status='SENT'") && call[1] === 'e1'
      )
    ).toBe(true);
  });

  it('relay records failure with retry backoff', async () => {
    publishConversationMembershipUpdatedEventNow.mockRejectedValueOnce(new Error('fail once'));
    prisma.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: 'e2',
        event_type: 'membership.conversation.updated',
        payload: { userId: 'u2', action: 'remove', conversationId: 'cv1' },
        attempts: 2,
      },
    ]);

    let poll: (() => void) | undefined;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((cb: () => void) => {
      poll = cb;
      return 1 as never;
    }) as never);

    const svc = await import('../src/services/membership-outbox.service.js');
    svc.startMembershipOutboxRelay();
    poll?.();
    await flushAsyncWork();

    await eventually(() =>
      prisma.$executeRawUnsafe.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('SET attempts = attempts + 1') &&
          call[1] === 'e2' &&
          call[2] === 'fail once' &&
          call[3] === '1000'
      )
    );
  });

  it('reads outbox stats and cleanup retention', async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ count: 3n }])
      .mockResolvedValueOnce([{ oldest: new Date('2026-02-01T00:00:00.000Z') }]);
    process.env.MEMBERSHIP_OUTBOX_RETENTION_DAYS = '5';

    const svc = await import('../src/services/membership-outbox.service.js');
    const stats = await svc.getMembershipOutboxStats();
    await svc.cleanupMembershipOutbox();

    expect(stats).toEqual({
      pendingCount: 3,
      oldestPendingAt: '2026-02-01T00:00:00.000Z',
    });
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("WHERE status='SENT'"),
      '5'
    );
  });

  it('cleanup scheduler starts once and logs cleanup failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    prisma.$executeRawUnsafe.mockRejectedValueOnce(new Error('cleanup failed'));
    process.env.MEMBERSHIP_OUTBOX_CLEANUP_INTERVAL_MS = '250';

    let cleanupTick: (() => void) | undefined;
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((cb: () => void) => {
      cleanupTick = cb;
      return 1 as never;
    }) as never);

    const svc = await import('../src/services/membership-outbox.service.js');
    svc.startMembershipOutboxCleanup();
    svc.startMembershipOutboxCleanup();
    cleanupTick?.();
    await flushAsyncWork();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('[outbox] cleanup failed:', expect.any(Error));
  });
});
