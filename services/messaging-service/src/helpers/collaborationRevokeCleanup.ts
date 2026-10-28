import type { Prisma } from "@jibbr/database";
import { enqueueMembershipOutboxEvent } from "../services/membership-outbox.service.js";

async function deactivateChannelMembersAndNotify(
  tx: Prisma.TransactionClient,
  channelId: string,
  where: Prisma.ChannelMemberWhereInput
): Promise<void> {
  const removed = await tx.channelMember.findMany({
    where: { ...where, channelId, isActive: true },
    select: { userId: true },
  });
  if (removed.length === 0) return;

  await tx.channelMember.updateMany({
    where: { channelId, isActive: true, userId: { in: removed.map((r) => r.userId) } },
    data: { isActive: false },
  });

  for (const row of removed) {
    await enqueueMembershipOutboxEvent(tx, "membership.channel.updated", {
      userId: row.userId,
      channelId,
      action: "remove",
    });
  }
}

async function deactivateConversationParticipantsAndNotify(
  tx: Prisma.TransactionClient,
  conversationId: string,
  where: Prisma.ConversationParticipantWhereInput
): Promise<void> {
  const removed = await tx.conversationParticipant.findMany({
    where: { ...where, conversationId, isActive: true },
    select: { userId: true },
  });
  if (removed.length === 0) return;

  await tx.conversationParticipant.updateMany({
    where: {
      conversationId,
      isActive: true,
      userId: { in: removed.map((r) => r.userId) },
    },
    data: { isActive: false },
  });

  for (const row of removed) {
    await enqueueMembershipOutboxEvent(tx, "membership.conversation.updated", {
      userId: row.userId,
      conversationId,
      action: "remove",
    });
  }
}

/**
 * Deactivate channel/DM participation for users who are not in the host workspace,
 * when a pairwise collaboration link is revoked.
 * Also enqueues membership removals so sockets leave the room and live huddles kick.
 */
export async function cleanupPairwiseCollaborationArtifacts(
  tx: Prisma.TransactionClient,
  linkId: string
): Promise<void> {
  const channels = await tx.channel.findMany({
    where: { collaborationId: linkId },
    select: { id: true, workspaceId: true },
  });

  for (const ch of channels) {
    const hostMembers = await tx.member.findMany({
      where: { workspaceId: ch.workspaceId, isActive: true },
      select: { userId: true },
    });
    const hostIds = hostMembers.map((m) => m.userId);
    await deactivateChannelMembersAndNotify(
      tx,
      ch.id,
      hostIds.length === 0 ? {} : { userId: { notIn: hostIds } }
    );
  }

  const conversations = await tx.conversation.findMany({
    where: { collaborationId: linkId },
    select: { id: true, workspaceId: true },
  });

  for (const c of conversations) {
    const hostMembers = await tx.member.findMany({
      where: { workspaceId: c.workspaceId, isActive: true },
      select: { userId: true },
    });
    const hostIds = hostMembers.map((m) => m.userId);
    await deactivateConversationParticipantsAndNotify(
      tx,
      c.id,
      hostIds.length === 0 ? {} : { userId: { notIn: hostIds } }
    );
  }
}

/**
 * After a workspace is removed from a collaboration group, remove every active member
 * of that workspace from all channels and group DMs tied to the group.
 */
export async function cleanupGroupMembershipArtifacts(
  tx: Prisma.TransactionClient,
  groupId: string,
  removedWorkspaceId: string
): Promise<void> {
  const removedWorkspaceMembers = await tx.member.findMany({
    where: { workspaceId: removedWorkspaceId, isActive: true },
    select: { userId: true },
  });
  const userIds = [...new Set(removedWorkspaceMembers.map((m) => m.userId))];
  if (userIds.length === 0) return;

  const channels = await tx.channel.findMany({
    where: { groupId },
    select: { id: true },
  });
  for (const ch of channels) {
    await deactivateChannelMembersAndNotify(tx, ch.id, { userId: { in: userIds } });
  }

  const convs = await tx.conversation.findMany({
    where: { groupId },
    select: { id: true },
  });
  for (const c of convs) {
    await deactivateConversationParticipantsAndNotify(tx, c.id, { userId: { in: userIds } });
  }
}

async function userKeepsSharedAccessViaOtherWorkspace(
  tx: Prisma.TransactionClient,
  remainingWorkspaceIds: string[],
  collaborationId: string | null,
  groupId: string | null
): Promise<boolean> {
  if (remainingWorkspaceIds.length === 0) return false;

  if (collaborationId) {
    const link = await tx.workspaceCollaboration.findFirst({
      where: {
        id: collaborationId,
        status: "ACTIVE",
        OR: [
          { workspaceAId: { in: remainingWorkspaceIds } },
          { workspaceBId: { in: remainingWorkspaceIds } },
        ],
      },
      select: { id: true },
    });
    return !!link;
  }

  if (groupId) {
    const membership = await tx.collaborationGroupMembership.findFirst({
      where: {
        groupId,
        status: "ACTIVE",
        workspaceId: { in: remainingWorkspaceIds },
      },
      select: { id: true },
    });
    return !!membership;
  }

  return false;
}

/**
 * When a user leaves a workspace, drop them from that workspace's channels/DMs
 * and from partner-hosted shared rooms they only reached through this workspace.
 */
export async function cleanupUserLeavingWorkspace(
  tx: Prisma.TransactionClient,
  userId: string,
  workspaceId: string
): Promise<void> {
  const remainingWorkspaceIds = (
    await tx.member.findMany({
      where: { userId, isActive: true, workspaceId: { not: workspaceId } },
      select: { workspaceId: true },
    })
  ).map((m) => m.workspaceId);

  const localChannels = await tx.channel.findMany({
    where: {
      workspaceId,
      members: { some: { userId, isActive: true } },
    },
    select: { id: true },
  });
  for (const ch of localChannels) {
    await deactivateChannelMembersAndNotify(tx, ch.id, { userId });
  }

  const sharedChannelMemberships = await tx.channelMember.findMany({
    where: {
      userId,
      isActive: true,
      channel: {
        workspaceId: { not: workspaceId },
        OR: [{ collaborationId: { not: null } }, { groupId: { not: null } }],
      },
    },
    select: {
      channelId: true,
      channel: { select: { collaborationId: true, groupId: true } },
    },
  });
  for (const row of sharedChannelMemberships) {
    const keep = await userKeepsSharedAccessViaOtherWorkspace(
      tx,
      remainingWorkspaceIds,
      row.channel.collaborationId,
      row.channel.groupId
    );
    if (!keep) {
      await deactivateChannelMembersAndNotify(tx, row.channelId, { userId });
    }
  }

  const localConversations = await tx.conversation.findMany({
    where: {
      workspaceId,
      participants: { some: { userId, isActive: true } },
    },
    select: { id: true },
  });
  for (const c of localConversations) {
    await deactivateConversationParticipantsAndNotify(tx, c.id, { userId });
  }

  const sharedConversationMemberships = await tx.conversationParticipant.findMany({
    where: {
      userId,
      isActive: true,
      conversation: {
        workspaceId: { not: workspaceId },
        OR: [{ collaborationId: { not: null } }, { groupId: { not: null } }],
      },
    },
    select: {
      conversationId: true,
      conversation: { select: { collaborationId: true, groupId: true } },
    },
  });
  for (const row of sharedConversationMemberships) {
    const keep = await userKeepsSharedAccessViaOtherWorkspace(
      tx,
      remainingWorkspaceIds,
      row.conversation.collaborationId,
      row.conversation.groupId
    );
    if (!keep) {
      await deactivateConversationParticipantsAndNotify(tx, row.conversationId, { userId });
    }
  }
}
