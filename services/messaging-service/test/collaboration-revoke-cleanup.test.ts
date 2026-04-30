import { describe, expect, it, vi } from 'vitest';

import {
  cleanupGroupMembershipArtifacts,
  cleanupPairwiseCollaborationArtifacts,
} from '../src/helpers/collaborationRevokeCleanup.js';

function makeTx() {
  return {
    channel: { findMany: vi.fn() },
    member: { findMany: vi.fn() },
    channelMember: { updateMany: vi.fn() },
    conversation: { findMany: vi.fn() },
    conversationParticipant: { updateMany: vi.fn() },
  } as any;
}

describe('collaborationRevokeCleanup', () => {
  it('pairwise cleanup deactivates non-host channel and conversation participants', async () => {
    const tx = makeTx();
    tx.channel.findMany.mockResolvedValue([{ id: 'c1', workspaceId: 'w1' }]);
    tx.member.findMany
      .mockResolvedValueOnce([{ userId: 'u-host' }]) // channel host members
      .mockResolvedValueOnce([{ userId: 'u-host' }]); // conversation host members
    tx.conversation.findMany.mockResolvedValue([{ id: 'cv1', workspaceId: 'w1' }]);

    await cleanupPairwiseCollaborationArtifacts(tx, 'link1');

    expect(tx.channelMember.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ channelId: 'c1', userId: { notIn: ['u-host'] } }),
      })
    );
    expect(tx.conversationParticipant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ conversationId: 'cv1', userId: { notIn: ['u-host'] } }),
      })
    );
  });

  it('group cleanup exits early when removed workspace has no active members', async () => {
    const tx = makeTx();
    tx.member.findMany.mockResolvedValue([]);
    await cleanupGroupMembershipArtifacts(tx, 'g1', 'w-removed');
    expect(tx.channel.findMany).not.toHaveBeenCalled();
    expect(tx.conversation.findMany).not.toHaveBeenCalled();
  });
});
