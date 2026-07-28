import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  channelMember: { findFirst: vi.fn() },
  conversationParticipant: { findFirst: vi.fn() },
}));

vi.mock('../src/config/database.js', () => ({ default: prisma }));

describe('membership.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks conversation participants for conv:* room ids', async () => {
    prisma.conversationParticipant.findFirst.mockResolvedValue({ id: 'cp-1' });

    const { assertRoomMember } = await import('../src/services/membership.service.js');
    await expect(assertRoomMember('user-1', 'conv:conversation-1')).resolves.toBeUndefined();

    expect(prisma.conversationParticipant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: 'conversation-1', userId: 'user-1', isActive: true },
      })
    );
    expect(prisma.channelMember.findFirst).not.toHaveBeenCalled();
  });

  it('rejects non-members for normal channel room ids', async () => {
    prisma.channelMember.findFirst.mockResolvedValue(null);

    const { assertRoomMember } = await import('../src/services/membership.service.js');
    await expect(assertRoomMember('user-1', 'channel-1')).rejects.toThrow(
      'You are not a member of this channel'
    );
  });
});
