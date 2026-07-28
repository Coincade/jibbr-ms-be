import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createStreamRedisClientMock = vi.hoisted(() => vi.fn());
const applyChannelMembershipUpdateMock = vi.hoisted(() => vi.fn());
const applyConversationMembershipUpdateMock = vi.hoisted(() => vi.fn());
const invalidateMembershipCacheForWorkspacesMock = vi.hoisted(() => vi.fn());

vi.mock('../src/config/redis.js', () => ({
  createStreamRedisClient: createStreamRedisClientMock,
}));

vi.mock('../src/config/streams.js', () => ({
  STREAMS: {
    MESSAGES: 'messages',
    NOTIFICATIONS: 'notifications',
    USER_EVENTS: 'user-events',
    WORKSPACE_EVENTS: 'workspace-events',
    CHANNEL_EVENTS: 'channel-events',
  },
  STREAMS_GROUP: 'group-1',
  STREAMS_CONSUMER: 'consumer-1',
  STREAMS_DEDUPE_TTL_SECONDS: 300,
  STREAMS_CLAIM_IDLE_MS: 1000,
  STREAMS_READ_COUNT: 10,
  STREAMS_BLOCK_MS: 100,
}));

vi.mock('../src/services/socket-membership-cache.service.js', () => ({
  applyChannelMembershipUpdate: applyChannelMembershipUpdateMock,
  applyConversationMembershipUpdate: applyConversationMembershipUpdateMock,
  invalidateMembershipCacheForWorkspaces: invalidateMembershipCacheForWorkspacesMock,
}));

describe('streams-consumer.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(async () => {
    const service = await import('../src/services/streams-consumer.service.js');
    service.__streamsTestUtils.resetState();
  });

  it('acks duplicate events without reprocessing them', async () => {
    const client = {
      set: vi.fn().mockResolvedValue(null),
      xAck: vi.fn().mockResolvedValue(1),
    };

    const service = await import('../src/services/streams-consumer.service.js');
    await service.__streamsTestUtils.processStreamMessage(client as any, 'messages', {
      id: '1-0',
      message: {
        eventId: 'evt-1',
        type: 'message.created',
        payload: JSON.stringify({ data: { channelId: 'ch-1' } }),
      },
    });

    expect(client.xAck).toHaveBeenCalledWith('messages', 'group-1', '1-0');
  });

  it('applies membership updates for user events', async () => {
    const io = { emit: vi.fn(), to: vi.fn(() => ({ emit: vi.fn() })) } as any;
    const client = {
      set: vi.fn().mockResolvedValue('OK'),
      xAck: vi.fn().mockResolvedValue(1),
    };

    const service = await import('../src/services/streams-consumer.service.js');
    service.setBroadcastIo(io);

    await service.__streamsTestUtils.processStreamMessage(client as any, 'user-events', {
      id: '2-0',
      message: {
        eventId: 'evt-2',
        type: 'membership.channel.updated',
        payload: JSON.stringify({
          data: { userId: 'u1', channelId: 'ch-1', action: 'add' },
        }),
      },
    });

    expect(applyChannelMembershipUpdateMock).toHaveBeenCalledWith('u1', 'ch-1', 'add');
    expect(client.xAck).toHaveBeenCalledWith('user-events', 'group-1', '2-0');
  });

  it('invalidates membership cache and fans out collaboration updates to all workspaces', async () => {
    const emit = vi.fn();
    const io = { emit: vi.fn(), to: vi.fn(() => ({ emit })) } as any;
    const client = {
      set: vi.fn().mockResolvedValue('OK'),
      xAck: vi.fn().mockResolvedValue(1),
    };

    const service = await import('../src/services/streams-consumer.service.js');
    service.setBroadcastIo(io);

    await service.__streamsTestUtils.processStreamMessage(client as any, 'workspace-events', {
      id: '3-0',
      message: {
        eventId: 'evt-3',
        type: 'collaboration.updated',
        payload: JSON.stringify({
          data: { workspaceIds: ['w1', 'w2'], reason: 'link_revoked', collaborationId: 'c1' },
        }),
      },
    });

    expect(invalidateMembershipCacheForWorkspacesMock).toHaveBeenCalledWith(['w1', 'w2']);
    expect(io.to).toHaveBeenCalledWith('workspace:w1');
    expect(io.to).toHaveBeenCalledWith('workspace:w2');
    expect(emit).toHaveBeenCalledWith(
      'collaboration_updated',
      expect.objectContaining({ workspaceIds: ['w1', 'w2'], reason: 'link_revoked' })
    );
  });
});
