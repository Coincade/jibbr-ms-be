import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  channel: { findUnique: vi.fn() },
  conversation: { findUnique: vi.fn() },
  channelMember: { findMany: vi.fn() },
  conversationParticipant: { findMany: vi.fn() },
}));

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('../src/websocket/utils.js', () => ({
  getWorkspaceRoomKey: vi.fn((workspaceId: string) => `workspace_${workspaceId}`),
}));

describe('workspace-huddle-broadcast.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('caches workspace resolution for channels', async () => {
    prisma.channel.findUnique.mockResolvedValue({ workspaceId: 'ws-1' });

    const service = await import('../src/services/workspace-huddle-broadcast.service.js');
    await expect(service.resolveWorkspaceIdForChannel('ch-1')).resolves.toBe('ws-1');
    await expect(service.resolveWorkspaceIdForChannel('ch-1')).resolves.toBe('ws-1');

    expect(prisma.channel.findUnique).toHaveBeenCalledTimes(1);
  });

  it('fans out DM huddle updates to conversation + participant personal rooms', async () => {
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })) } as any;
    prisma.conversation.findUnique.mockResolvedValue({ workspaceId: 'ws-2' });
    prisma.conversationParticipant.findMany.mockResolvedValue([
      { userId: 'u1' },
      { userId: 'u2' },
    ]);

    const service = await import('../src/services/workspace-huddle-broadcast.service.js');
    service.setWorkspaceHuddleIo(io);
    await service.fanoutWorkspaceHuddleFromConversation('dm-1', { active: true });

    const rooms = io.to.mock.calls.map((c: string[]) => c[0]);
    expect(rooms).toContain('dm-1');
    expect(rooms).toContain('user_u1');
    expect(rooms).toContain('user_u2');
    expect(rooms).not.toContain('workspace_ws-2');
    expect(emit).toHaveBeenCalledWith(
      'workspace_huddle_updated',
      expect.objectContaining({
        workspaceId: 'ws-2',
        conversationId: 'dm-1',
        roomId: 'conv:dm-1',
        active: true,
      })
    );
  });

  it('fans out channel huddle updates to channel + member rooms, not workspace', async () => {
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })) } as any;
    prisma.channel.findUnique.mockResolvedValue({ workspaceId: 'ws-org' });
    prisma.channelMember.findMany.mockResolvedValue([
      { userId: 'user-a' },
      { userId: 'user-b' },
    ]);

    const service = await import('../src/services/workspace-huddle-broadcast.service.js');
    service.setWorkspaceHuddleIo(io);
    await service.fanoutWorkspaceHuddleFromChannel('org-ch', {
      active: true,
      participantCount: 1,
      hostUserId: 'user-a',
    });

    const rooms = io.to.mock.calls.map((c: string[]) => c[0]);
    expect(rooms).toContain('org-ch');
    expect(rooms).toContain('user_user-a');
    expect(rooms).toContain('user_user-b');
    expect(rooms).not.toContain('workspace_ws-org');

    expect(emit).toHaveBeenCalledWith(
      'workspace_huddle_updated',
      expect.objectContaining({
        workspaceId: 'ws-org',
        channelId: 'org-ch',
        roomId: 'org-ch',
        active: true,
      })
    );
  });
});
