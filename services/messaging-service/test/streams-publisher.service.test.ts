import { beforeEach, describe, expect, it, vi } from 'vitest';

const xAdd = vi.hoisted(() => vi.fn());
const createStreamRedisClient = vi.hoisted(() => vi.fn(async () => ({ xAdd })));
const randomUUID = vi.hoisted(() => vi.fn(() => 'evt-123'));

vi.mock('../src/config/redis.js', () => ({ createStreamRedisClient }));
vi.mock('crypto', () => ({ randomUUID }));

describe('streams-publisher.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('publishes message.created payload to message stream', async () => {
    const svc = await import('../src/services/streams-publisher.service.js');
    await svc.publishMessageCreatedEvent({
      id: 'm1',
      content: 'hello',
      userId: 'u1',
      channelId: 'c1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      attachments: [{ key: 'a' }],
      reactions: [{ emoji: ':)' }],
    });

    expect(createStreamRedisClient).toHaveBeenCalledTimes(1);
    expect(xAdd).toHaveBeenCalledWith(
      'messages',
      '*',
      expect.objectContaining({
        eventId: 'evt-123',
        type: 'message.created',
        source: 'messaging-service',
      })
    );
    const payload = JSON.parse(xAdd.mock.calls[0][2].payload);
    expect(payload.data).toEqual(
      expect.objectContaining({
        id: 'm1',
        content: 'hello',
        userId: 'u1',
        channelId: 'c1',
      })
    );
  });

  it('reuses cached stream client across multiple publishes', async () => {
    const svc = await import('../src/services/streams-publisher.service.js');
    await svc.publishMessageUpdatedEvent({ id: 'm1', content: 'v2', userId: 'u1' });
    await svc.publishMessageDeletedEvent({ id: 'm1' });

    expect(createStreamRedisClient).toHaveBeenCalledTimes(1);
    expect(xAdd).toHaveBeenCalledTimes(2);
  });

  it('publishes collaboration invalidate with unique workspaceIds', async () => {
    const svc = await import('../src/services/streams-publisher.service.js');
    await svc.publishCollaborationInvalidate({
      workspaceIds: ['w1', 'w1', '', 'w2'],
      reason: 'link_approved',
      collaborationId: 'col1',
    });

    expect(xAdd).toHaveBeenCalledWith(
      'workspace-events',
      '*',
      expect.objectContaining({
        type: 'collaboration.updated',
      })
    );
    const payload = JSON.parse(xAdd.mock.calls[0][2].payload);
    expect(payload.data.workspaceIds).toEqual(['w1', 'w2']);
  });

  it('does not publish collaboration invalidate when no valid workspace ids', async () => {
    const svc = await import('../src/services/streams-publisher.service.js');
    await svc.publishCollaborationInvalidate({
      workspaceIds: ['', ''],
      reason: 'request_created',
    });

    expect(xAdd).not.toHaveBeenCalled();
  });

  it('swallows publisher errors and logs failure', async () => {
    xAdd.mockRejectedValueOnce(new Error('redis down'));
    const svc = await import('../src/services/streams-publisher.service.js');

    await expect(
      svc.publishWorkspaceEvent('workspace.created', {
        id: 'w1',
        name: 'Acme',
        joinCode: 'ABC123',
        userId: 'u1',
      })
    ).resolves.toBeUndefined();
  });

  it('publishes channel event with normalized date fields', async () => {
    const svc = await import('../src/services/streams-publisher.service.js');
    await svc.publishChannelEvent('channel.updated', {
      id: 'c1',
      name: 'general',
      type: 'PUBLIC',
      workspaceId: 'w1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const payload = JSON.parse(xAdd.mock.calls[0][2].payload);
    expect(payload.type).toBe('channel.updated');
    expect(payload.data.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
