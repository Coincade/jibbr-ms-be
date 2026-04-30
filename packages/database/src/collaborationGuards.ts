import type { PrismaClient } from "@prisma/client";

/**
 * Shared collaboration authorization (used by messaging-service and socket-service).
 * All functions take an explicit Prisma client (or transaction client).
 */

export async function isCollaborationDmMutationAllowedForConversation(
  prisma: PrismaClient,
  conversationId: string
): Promise<boolean> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { collaborationId: true, groupId: true },
  });
  if (!conv) return false;

  if (conv.collaborationId) {
    const link = await prisma.workspaceCollaboration.findFirst({
      where: { id: conv.collaborationId, status: "ACTIVE" },
      include: { policy: { select: { allowCrossWorkspaceDm: true } } },
    });
    return !!(link?.policy.allowCrossWorkspaceDm);
  }

  if (conv.groupId) {
    const group = await prisma.collaborationGroup.findFirst({
      where: { id: conv.groupId, status: "ACTIVE" },
      include: { policy: { select: { allowCrossWorkspaceDm: true } } },
    });
    return !!(group?.policy.allowCrossWorkspaceDm);
  }

  return true;
}

/**
 * Whether the user may post/edit/react/etc. in this channel.
 * Host-workspace members may always mutate. External members require an active
 * collaboration link or group membership with allowSharedChannels.
 */
export async function canUserMutateSharedChannel(
  prisma: PrismaClient,
  userId: string,
  channelId: string
): Promise<boolean> {
  const [channelMember, channel] = await Promise.all([
    prisma.channelMember.findFirst({
      where: { channelId, userId, isActive: true },
      select: { id: true },
    }),
    prisma.channel.findFirst({
      where: { id: channelId, deletedAt: null },
      select: { workspaceId: true, collaborationId: true, groupId: true },
    }),
  ]);

  if (!channel || !channelMember) return false;
  if (!channel.collaborationId && !channel.groupId) return true;

  const isHostMember = await prisma.member.findFirst({
    where: { userId, workspaceId: channel.workspaceId, isActive: true },
    select: { id: true },
  });
  if (isHostMember) return true;

  if (channel.collaborationId) {
    const link = await prisma.workspaceCollaboration.findFirst({
      where: { id: channel.collaborationId, status: "ACTIVE" },
      include: { policy: { select: { allowSharedChannels: true } } },
    });
    return !!(link?.policy.allowSharedChannels);
  }

  if (channel.groupId) {
    const group = await prisma.collaborationGroup.findFirst({
      where: { id: channel.groupId, status: "ACTIVE" },
      include: { policy: { select: { allowSharedChannels: true } } },
    });
    if (!group?.policy.allowSharedChannels) return false;

    const userWorkspaces = await prisma.member.findMany({
      where: { userId, isActive: true },
      select: { workspaceId: true },
    });
    const uw = userWorkspaces.map((m) => m.workspaceId);
    if (uw.length === 0) return false;

    const inGroup = await prisma.collaborationGroupMembership.findFirst({
      where: {
        groupId: channel.groupId,
        status: "ACTIVE",
        workspaceId: { in: uw },
      },
      select: { id: true },
    });
    return !!inGroup;
  }

  return false;
}

/**
 * Read access for shared-channel history (same semantics as messaging-service).
 */
export async function canUserReadChannelHistory(
  prisma: PrismaClient,
  channelId: string,
  userId: string
): Promise<boolean> {
  const [channelMember, channel] = await Promise.all([
    prisma.channelMember.findFirst({
      where: { channelId, userId, isActive: true },
      select: { id: true },
    }),
    prisma.channel.findUnique({
      where: { id: channelId },
      select: { workspaceId: true, collaborationId: true, groupId: true },
    }),
  ]);

  if (!channel || !channelMember) return false;
  if (!channel.collaborationId && !channel.groupId) return true;

  if (channel.collaborationId) {
    const activeLink = await prisma.workspaceCollaboration.findFirst({
      where: { id: channel.collaborationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (activeLink) return true;
  }

  if (channel.groupId) {
    const activeGroup = await prisma.collaborationGroup.findFirst({
      where: { id: channel.groupId, status: "ACTIVE" },
      select: { id: true },
    });
    if (activeGroup) return true;
  }

  const hostWorkspaceMember = await prisma.member.findFirst({
    where: { userId, workspaceId: channel.workspaceId, isActive: true },
    select: { id: true },
  });
  return !!hostWorkspaceMember;
}

export type ChannelReadMeta = {
  workspaceId: string;
  collaborationId: string | null;
  groupId: string | null;
  deletedAt: Date | null;
};

/**
 * Filter unread-count rows in O(1) queries per dimension instead of N sequential
 * canUserReadChannelHistory calls (avoids client timeouts on many channels).
 */
export async function filterUnreadChannelRowsForUser<
  T extends { channelId: string; channel: ChannelReadMeta },
>(prisma: PrismaClient, userId: string, entries: T[]): Promise<T[]> {
  if (entries.length === 0) return [];

  const userWorkspaceIds = (
    await prisma.member.findMany({
      where: { userId, isActive: true },
      select: { workspaceId: true },
    })
  ).map((m) => m.workspaceId);
  const uwSet = new Set(userWorkspaceIds);

  const collabIds = [...new Set(entries.map((e) => e.channel.collaborationId).filter(Boolean))] as string[];
  const groupIds = [...new Set(entries.map((e) => e.channel.groupId).filter(Boolean))] as string[];

  const [activeLinks, activeGroups] = await Promise.all([
    collabIds.length
      ? prisma.workspaceCollaboration.findMany({
          where: { id: { in: collabIds }, status: "ACTIVE" },
          select: { id: true },
        })
      : Promise.resolve([]),
    groupIds.length
      ? prisma.collaborationGroup.findMany({
          where: { id: { in: groupIds }, status: "ACTIVE" },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);

  const activeLinkSet = new Set(activeLinks.map((l) => l.id));
  const activeGroupSet = new Set(activeGroups.map((g) => g.id));

  return entries.filter((e) => {
    const ch = e.channel;
    if (ch.deletedAt) return false;
    if (!ch.collaborationId && !ch.groupId) return true;
    if (ch.collaborationId && activeLinkSet.has(ch.collaborationId)) return true;
    if (ch.groupId && activeGroupSet.has(ch.groupId)) return true;
    return uwSet.has(ch.workspaceId);
  });
}

/**
 * Which of the candidate user IDs may still read this channel (for notifications).
 */
export async function filterUserIdsWhoCanReadChannel(
  prisma: PrismaClient,
  channelId: string,
  candidateUserIds: string[]
): Promise<Set<string>> {
  const allowed = new Set<string>();
  if (candidateUserIds.length === 0) return allowed;

  const unique = [...new Set(candidateUserIds)];

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, deletedAt: null },
    select: { workspaceId: true, collaborationId: true, groupId: true },
  });
  if (!channel) return allowed;

  const activeMembers = await prisma.channelMember.findMany({
    where: { channelId, userId: { in: unique }, isActive: true },
    select: { userId: true },
  });
  const activeSet = new Set(activeMembers.map((m) => m.userId));
  if (activeSet.size === 0) return allowed;

  const workspaceRows = await prisma.member.findMany({
    where: { userId: { in: [...activeSet] }, isActive: true },
    select: { userId: true, workspaceId: true },
  });
  const workspacesByUser = new Map<string, Set<string>>();
  for (const r of workspaceRows) {
    if (!workspacesByUser.has(r.userId)) workspacesByUser.set(r.userId, new Set());
    workspacesByUser.get(r.userId)!.add(r.workspaceId);
  }

  let linkActive = false;
  let groupActive = false;
  if (channel.collaborationId) {
    const link = await prisma.workspaceCollaboration.findFirst({
      where: { id: channel.collaborationId, status: "ACTIVE" },
      select: { id: true },
    });
    linkActive = !!link;
  }
  if (channel.groupId) {
    const g = await prisma.collaborationGroup.findFirst({
      where: { id: channel.groupId, status: "ACTIVE" },
      select: { id: true },
    });
    groupActive = !!g;
  }

  const hostWs = channel.workspaceId;
  for (const uid of unique) {
    if (!activeSet.has(uid)) continue;
    if (!channel.collaborationId && !channel.groupId) {
      allowed.add(uid);
      continue;
    }
    if (channel.collaborationId && linkActive) {
      allowed.add(uid);
      continue;
    }
    if (channel.groupId && groupActive) {
      allowed.add(uid);
      continue;
    }
    if (workspacesByUser.get(uid)?.has(hostWs)) allowed.add(uid);
  }
  return allowed;
}
