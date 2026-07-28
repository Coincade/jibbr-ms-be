import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  channelMember: { findFirst: vi.fn(), findMany: vi.fn() },
  conversationParticipant: { findFirst: vi.fn(), findMany: vi.fn() },
  member: { findFirst: vi.fn(), findMany: vi.fn() },
}));

const multi = vi.hoisted(() => ({
  del: vi.fn(),
  sAdd: vi.fn(),
  sRem: vi.fn(),
  expire: vi.fn(),
  exec: vi.fn(async () => []),
}));

const redisClient = vi.hoisted(() => ({
  sIsMember: vi.fn(),
  multi: vi.fn(() => multi),
}));

const retryWithBackoffMock = vi.hoisted(() =>
  vi.fn(async <T>(operation: () => Promise<T>) => operation())
);

const metricsIncrementMock = vi.hoisted(() => vi.fn());

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('../src/config/redis.js', () => ({
  getStateRedisClient: vi.fn(async () => redisClient),
}));
vi.mock('../src/libs/retry.js', () => ({
  retryWithBackoff: retryWithBackoffMock,
}));
vi.mock('../src/services/realtime-observability.service.js', () => ({
  realtimeMetrics: { increment: metricsIncrementMock },
}));

const ORIGINAL_ENV = { ...process.env };

describe('socket-membership-cache.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      SOCKET_DB_FALLBACK_ENABLED: '1',
      SOCKET_DB_FALLBACK_BREAKER_THRESHOLD: '2',
      SOCKET_DB_FALLBACK_BREAKER_COOLDOWN_MS: '1000',
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('falls back to DB when Redis membership checks fail', async () => {
    redisClient.sIsMember.mockRejectedValue(new Error('redis down'));
    prisma.channelMember.findFirst.mockResolvedValue({ id: 'cm-1' });

    const service = await import('../src/services/socket-membership-cache.service.js');
    await expect(service.validateChannelMembershipCached('user-1', 'ch-1')).resolves.toBe(true);

    expect(prisma.channelMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId: 'ch-1', userId: 'user-1', isActive: true },
      })
    );
  });

  it('writes redis invalidations for all affected workspace members', async () => {
    prisma.member.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u1' }]);

    const service = await import('../src/services/socket-membership-cache.service.js');
    await service.invalidateMembershipCacheForWorkspaces(['ws-1']);

    expect(prisma.member.findMany).toHaveBeenCalled();
    expect(multi.del).toHaveBeenCalledWith('user:u1:channels', 'user:u1:conversations', 'user:u1:workspaces');
    expect(multi.del).toHaveBeenCalledWith('user:u2:channels', 'user:u2:conversations', 'user:u2:workspaces');
  });
});
