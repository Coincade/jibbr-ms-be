import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueMembershipOutboxEvent = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../src/services/membership-outbox.service.js', () => ({
  enqueueMembershipOutboxEvent,
}));

import {
  cleanupGroupMembershipArtifacts,
  cleanupPairwiseCollaborationArtifacts,
  cleanupUserLeavingWorkspace,
} from '../src/helpers/collaborationRevokeCleanup.js';

function makeTx() {
  return {
    channel: { findMany: vi.fn() },
    member: { findMany: vi.fn() },
    channelMember: { findMany: vi.fn(), updateMany: vi.fn() },
    conversation: { findMany: vi.fn() },
    conversationParticipant: { findMany: vi.fn(), updateMany: vi.fn() },
    workspaceCollaboration: { findFirst: vi.fn() },
    collaborationGroupMembership: { findFirst: vi.fn() },
  } as any;
}

describe('collaborationRevokeCleanup', () => {
  beforeEach(() => {
    enqueueMembershipOutboxEvent.mockClear();
  });

  it('pairwise cleanup deactivates non-host members and kicks them from sockets/huddles', async () => {
    const tx = makeTx();
    tx.channel.findMany.mockResolvedValue([{ id: 'c1', workspaceId: 'w1' }]);
    tx.member.findMany
      .mockResolvedValueOnce([{ userId: 'u-host' }]) // channel host members
      .mockResolvedValueOnce([{ userId: 'u-host' }]); // conversation host members
    tx.channelMember.findMany.mockResolvedValue([{ userId: 'u-guest' }]);
    tx.conversation.findMany.mockResolvedValue([{ id: 'cv1', workspaceId: 'w1' }]);
    tx.conversationParticipant.findMany.mockResolvedValue([{ userId: 'u-guest' }]);

    await cleanupPairwiseCollaborationArtifacts(tx, 'link1');

    expect(tx.channelMember.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ channelId: 'c1', userId: { in: ['u-guest'] } }),
      })
    );
    expect(tx.conversationParticipant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ conversationId: 'cv1', userId: { in: ['u-guest'] } }),
      })
    );
    expect(enqueueMembershipOutboxEvent).toHaveBeenCalledWith(
      tx,
      'membership.channel.updated',
      { userId: 'u-guest', channelId: 'c1', action: 'remove' }
    );
    expect(enqueueMembershipOutboxEvent).toHaveBeenCalledWith(
      tx,
      'membership.conversation.updated',
      { userId: 'u-guest', conversationId: 'cv1', action: 'remove' }
    );
  });

  it('group cleanup exits early when removed workspace has no active members', async () => {
    const tx = makeTx();
    tx.member.findMany.mockResolvedValue([]);
    await cleanupGroupMembershipArtifacts(tx, 'g1', 'w-removed');
    expect(tx.channel.findMany).not.toHaveBeenCalled();
    expect(tx.conversation.findMany).not.toHaveBeenCalled();
  });

  it('group cleanup enqueues removals so leavers stop receiving messages and huddles', async () => {
    const tx = makeTx();
    tx.member.findMany.mockResolvedValue([{ userId: 'u-removed' }]);
    tx.channel.findMany.mockResolvedValue([{ id: 'g-ch' }]);
    tx.conversation.findMany.mockResolvedValue([{ id: 'g-dm' }]);
    tx.channelMember.findMany.mockResolvedValue([{ userId: 'u-removed' }]);
    tx.conversationParticipant.findMany.mockResolvedValue([{ userId: 'u-removed' }]);

    await cleanupGroupMembershipArtifacts(tx, 'g1', 'w-removed');

    expect(enqueueMembershipOutboxEvent).toHaveBeenCalledWith(
      tx,
      'membership.channel.updated',
      { userId: 'u-removed', channelId: 'g-ch', action: 'remove' }
    );
    expect(enqueueMembershipOutboxEvent).toHaveBeenCalledWith(
      tx,
      'membership.conversation.updated',
      { userId: 'u-removed', conversationId: 'g-dm', action: 'remove' }
    );
  });

  it('leaving a workspace kicks the user from local and partner-only shared rooms', async () => {
    const tx = makeTx();
    tx.member.findMany.mockResolvedValue([]);
    tx.channel.findMany.mockResolvedValue([{ id: 'local-ch' }]);
    tx.conversation.findMany.mockResolvedValue([{ id: 'local-dm' }]);
    tx.channelMember.findMany
      .mockResolvedValueOnce([{ userId: 'u1' }]) // local channel deactivate
      .mockResolvedValueOnce([
        { channelId: 'partner-ch', channel: { collaborationId: 'link-1', groupId: null } },
      ])
      .mockResolvedValueOnce([{ userId: 'u1' }]); // partner channel deactivate
    tx.conversationParticipant.findMany
      .mockResolvedValueOnce([{ userId: 'u1' }]) // local dm deactivate
      .mockResolvedValueOnce([]);
    tx.workspaceCollaboration.findFirst.mockResolvedValue(null);

    await cleanupUserLeavingWorkspace(tx, 'u1', 'w-left');

    expect(enqueueMembershipOutboxEvent).toHaveBeenCalledWith(
      tx,
      'membership.channel.updated',
      { userId: 'u1', channelId: 'local-ch', action: 'remove' }
    );
    expect(enqueueMembershipOutboxEvent).toHaveBeenCalledWith(
      tx,
      'membership.channel.updated',
      { userId: 'u1', channelId: 'partner-ch', action: 'remove' }
    );
    expect(enqueueMembershipOutboxEvent).toHaveBeenCalledWith(
      tx,
      'membership.conversation.updated',
      { userId: 'u1', conversationId: 'local-dm', action: 'remove' }
    );
  });

  it('keeps a shared channel when the user still belongs to the other linked workspace', async () => {
    const tx = makeTx();
    tx.member.findMany.mockResolvedValue([{ workspaceId: 'w-other' }]);
    tx.channel.findMany.mockResolvedValue([]);
    tx.conversation.findMany.mockResolvedValue([]);
    tx.channelMember.findMany.mockResolvedValue([
      { channelId: 'partner-ch', channel: { collaborationId: 'link-1', groupId: null } },
    ]);
    tx.conversationParticipant.findMany.mockResolvedValue([]);
    tx.workspaceCollaboration.findFirst.mockResolvedValue({ id: 'link-1' });

    await cleanupUserLeavingWorkspace(tx, 'u1', 'w-left');

    expect(enqueueMembershipOutboxEvent).not.toHaveBeenCalled();
  });
});
