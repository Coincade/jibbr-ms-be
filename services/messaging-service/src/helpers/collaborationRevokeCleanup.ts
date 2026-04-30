import type { Prisma } from "@jibbr/database";

/**
 * Deactivate channel/DM participation for users who are not in the host workspace,
 * when a pairwise collaboration link is revoked.
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
    if (hostIds.length === 0) {
      await tx.channelMember.updateMany({
        where: { channelId: ch.id, isActive: true },
        data: { isActive: false },
      });
      continue;
    }
    await tx.channelMember.updateMany({
      where: { channelId: ch.id, isActive: true, userId: { notIn: hostIds } },
      data: { isActive: false },
    });
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
    if (hostIds.length === 0) {
      await tx.conversationParticipant.updateMany({
        where: { conversationId: c.id, isActive: true },
        data: { isActive: false },
      });
      continue;
    }
    await tx.conversationParticipant.updateMany({
      where: { conversationId: c.id, isActive: true, userId: { notIn: hostIds } },
      data: { isActive: false },
    });
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
    await tx.channelMember.updateMany({
      where: {
        channelId: ch.id,
        userId: { in: userIds },
        isActive: true,
      },
      data: { isActive: false },
    });
  }

  const convs = await tx.conversation.findMany({
    where: { groupId },
    select: { id: true },
  });
  for (const c of convs) {
    await tx.conversationParticipant.updateMany({
      where: {
        conversationId: c.id,
        userId: { in: userIds },
        isActive: true,
      },
      data: { isActive: false },
    });
  }
}
