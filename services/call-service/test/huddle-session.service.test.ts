import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  channel: { findUnique: vi.fn() },
  conversation: { findUnique: vi.fn() },
  huddleSession: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
}));

vi.mock('../src/config/database.js', () => ({ default: prisma }));

describe('huddle-session.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.huddleSession.findFirst.mockResolvedValue(null);
  });

  it('creates a session record for conversation rooms using the conversation workspace', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ workspaceId: 'workspace-2' });
    prisma.huddleSession.create.mockResolvedValue({ id: 'session-row-1' });

    const { startHuddleSessionRecord } = await import('../src/services/huddle-session.service.js');
    const id = await startHuddleSessionRecord('conv:conversation-1', 'user-1', 'ms-1');

    expect(id).toBe('session-row-1');
    expect(prisma.huddleSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId: 'conv:conversation-1',
          channelId: null,
          conversationId: 'conversation-1',
          workspaceId: 'workspace-2',
        }),
      })
    );
  });

  it('returns an existing open session instead of creating a duplicate', async () => {
    prisma.huddleSession.findFirst.mockResolvedValue({ id: 'existing-open' });

    const { startHuddleSessionRecord } = await import('../src/services/huddle-session.service.js');
    const id = await startHuddleSessionRecord('room-1', 'user-1', 'ms-1');

    expect(id).toBe('existing-open');
    expect(prisma.huddleSession.create).not.toHaveBeenCalled();
  });

  it('recovers from unique race by re-fetching the open session', async () => {
    prisma.huddleSession.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'winner-row' });
    prisma.channel.findUnique.mockResolvedValue({ workspaceId: 'ws-1' });
    prisma.huddleSession.create.mockRejectedValue({ code: 'P2002' });

    const { startHuddleSessionRecord } = await import('../src/services/huddle-session.service.js');
    const id = await startHuddleSessionRecord('room-1', 'user-1', 'ms-1');

    expect(id).toBe('winner-row');
  });

  it('returns zero when ending a huddle session update fails', async () => {
    prisma.huddleSession.updateMany.mockRejectedValue(new Error('db error'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { endHuddleSessionRecord } = await import('../src/services/huddle-session.service.js');
    await expect(endHuddleSessionRecord('room-1', 4)).resolves.toBe(0);

    expect(warnSpy).toHaveBeenCalled();
  });
});
