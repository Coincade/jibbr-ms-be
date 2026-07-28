import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  channel: { findUnique: vi.fn() },
  conversation: { findUnique: vi.fn() },
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

  it('fans out DM huddle updates to the conversation room', async () => {
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })) } as any;
    prisma.conversation.findUnique.mockResolvedValue({ workspaceId: 'ws-2' });

    const service = await import('../src/services/workspace-huddle-broadcast.service.js');
    service.setWorkspaceHuddleIo(io);
    await service.fanoutWorkspaceHuddleFromConversation('dm-1', { active: true });

    expect(io.to).toHaveBeenCalledWith('dm-1');
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
});
