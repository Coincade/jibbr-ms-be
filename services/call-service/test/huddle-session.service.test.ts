import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  channel: { findUnique: vi.fn() },
  conversation: { findUnique: vi.fn() },
  huddleSession: { create: vi.fn(), updateMany: vi.fn() },
}));

vi.mock('../src/config/database.js', () => ({ default: prisma }));

describe('huddle-session.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('returns zero when ending a huddle session update fails', async () => {
    prisma.huddleSession.updateMany.mockRejectedValue(new Error('db error'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { endHuddleSessionRecord } = await import('../src/services/huddle-session.service.js');
    await expect(endHuddleSessionRecord('room-1', 4)).resolves.toBe(0);

    expect(warnSpy).toHaveBeenCalled();
  });
});
