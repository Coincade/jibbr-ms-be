import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  channelMember: { findFirst: vi.fn() },
  conversationParticipant: { findFirst: vi.fn() },
  conversation: { findUnique: vi.fn() },
  member: { findFirst: vi.fn() },
  channel: { findFirst: vi.fn(), findUnique: vi.fn() },
  workspaceCollaboration: { findFirst: vi.fn() },
  collaborationGroup: { findFirst: vi.fn() },
  collaborationGroupMembership: { findFirst: vi.fn() },
}));

const canUserReadChannelHistory = vi.hoisted(() => vi.fn());
const isCollaborationDmMutationAllowedForConversation = vi.hoisted(() => vi.fn());

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('@jibbr/database', () => ({
  canUserReadChannelHistory,
  isCollaborationDmMutationAllowedForConversation,
}));

describe('membership.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks conversation participants for conv:* room ids', async () => {
    prisma.conversationParticipant.findFirst.mockResolvedValue({ id: 'cp-1' });
    prisma.conversation.findUnique.mockResolvedValue({
      workspaceId: 'w1',
      collaborationId: null,
      groupId: null,
    });

    const { assertRoomMember } = await import('../src/services/membership.service.js');
    await expect(assertRoomMember('user-1', 'conv:conversation-1')).resolves.toBeUndefined();

    expect(prisma.conversationParticipant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: 'conversation-1', userId: 'user-1', isActive: true },
      })
    );
    expect(canUserReadChannelHistory).not.toHaveBeenCalled();
  });

  it('rejects non-members for normal channel room ids', async () => {
    canUserReadChannelHistory.mockResolvedValue(false);

    const { assertRoomMember } = await import('../src/services/membership.service.js');
    await expect(assertRoomMember('user-1', 'channel-1')).rejects.toThrow(
      'You are not a member of this channel'
    );
  });

  it('rejects collaborator huddle join after the shared link is revoked', async () => {
    prisma.conversationParticipant.findFirst.mockResolvedValue({ id: 'cp-1' });
    prisma.conversation.findUnique.mockResolvedValue({
      workspaceId: 'host-ws',
      collaborationId: 'link-1',
      groupId: null,
    });
    isCollaborationDmMutationAllowedForConversation.mockResolvedValue(false);
    prisma.member.findFirst.mockResolvedValue(null);

    const { assertRoomMember } = await import('../src/services/membership.service.js');
    await expect(assertRoomMember('guest-1', 'conv:dm-1')).rejects.toThrow(
      'You are not a participant in this conversation'
    );
  });
});
