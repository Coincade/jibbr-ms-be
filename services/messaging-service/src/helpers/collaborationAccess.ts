import prisma from "../config/database.js";

export type CollaborationResourceType = "workspace" | "channel" | "conversation" | "message";

const isAdminRole = (role?: string | null) => role === "ADMIN";

export const isWorkspaceAdmin = async (userId: string, workspaceId: string): Promise<boolean> => {
  const [workspace, member] = await Promise.all([
    prisma.workspace.findFirst({
      where: { id: workspaceId, isActive: true, deletedAt: null },
      select: { userId: true },
    }),
    prisma.member.findFirst({
      where: { userId, workspaceId, isActive: true },
      select: { role: true },
    }),
  ]);

  if (!workspace) return false;
  return workspace.userId === userId || isAdminRole(member?.role);
};

export const getActiveUserWorkspaceIds = async (userId: string): Promise<string[]> => {
  const memberships = await prisma.member.findMany({
    where: { userId, isActive: true },
    select: { workspaceId: true },
  });
  return memberships.map((membership) => membership.workspaceId);
};

export const findActiveCollaborationBetweenWorkspaces = async (
  workspaceAId: string,
  workspaceBId: string
) => {
  return prisma.workspaceCollaboration.findFirst({
    where: {
      status: "ACTIVE",
      OR: [
        { workspaceAId, workspaceBId },
        { workspaceAId: workspaceBId, workspaceBId: workspaceAId },
      ],
    },
    include: {
      policy: true,
      workspaceA: {
        select: { id: true, fileAttachmentsEnabled: true },
      },
      workspaceB: {
        select: { id: true, fileAttachmentsEnabled: true },
      },
    },
  });
};

export const isPolicyAllowedForResource = (
  resourceType: CollaborationResourceType,
  policy: {
    allowExternalDiscovery: boolean;
    allowCrossWorkspaceDm: boolean;
    allowSharedChannels: boolean;
  }
): boolean => {
  switch (resourceType) {
    case "workspace":
      return policy.allowExternalDiscovery;
    case "conversation":
      return policy.allowCrossWorkspaceDm;
    case "channel":
    case "message":
      return policy.allowSharedChannels;
    default:
      return false;
  }
};

export const canAccessWorkspaceResource = async (
  userId: string,
  resourceWorkspaceId: string,
  resourceType: CollaborationResourceType
): Promise<boolean> => {
  const directMembership = await prisma.member.findFirst({
    where: {
      userId,
      workspaceId: resourceWorkspaceId,
      isActive: true,
    },
    select: { id: true },
  });

  if (directMembership) {
    return true;
  }

  const userWorkspaceIds = await getActiveUserWorkspaceIds(userId);
  if (!userWorkspaceIds.length) return false;

  const links = await prisma.workspaceCollaboration.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        {
          workspaceAId: { in: userWorkspaceIds },
          workspaceBId: resourceWorkspaceId,
        },
        {
          workspaceAId: resourceWorkspaceId,
          workspaceBId: { in: userWorkspaceIds },
        },
      ],
    },
    include: {
      policy: {
        select: {
          allowExternalDiscovery: true,
          allowCrossWorkspaceDm: true,
          allowSharedChannels: true,
        },
      },
    },
  });

  return links.some((link) => isPolicyAllowedForResource(resourceType, link.policy));
};

/**
 * Whether this DM conversation may be mutated (send, edit, delete, react, forward-in).
 * Same-workspace DMs (no collaborationId) are always allowed.
 * Cross-workspace DMs require an ACTIVE link and allowCrossWorkspaceDm on the policy.
 */
export const isCollaborationDmMutationAllowedForConversation = async (
  conversationId: string
): Promise<boolean> => {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { collaborationId: true },
  });
  if (!conv) return false;
  if (!conv.collaborationId) return true;

  const link = await prisma.workspaceCollaboration.findFirst({
    where: {
      id: conv.collaborationId,
      status: "ACTIVE",
    },
    include: {
      policy: { select: { allowCrossWorkspaceDm: true } },
    },
  });
  return !!(link?.policy.allowCrossWorkspaceDm);
};

/**
 * Whether the collaboration link is ACTIVE and its policy allows file sharing.
 * For shared channels, the creator workspace's file-attachment toggle is applied
 * separately via `canUserSendAttachmentsToChannel` / `isFileAttachmentsEnabledForChannel`
 * (host = channel.workspaceId).
 */
export const isCollaborationFileSharingAllowed = async (
  collaborationId: string
): Promise<boolean> => {
  const link = await prisma.workspaceCollaboration.findFirst({
    where: { id: collaborationId, status: "ACTIVE" },
    include: {
      policy: {
        select: {
          allowFileSharing: true,
        },
      },
    },
  });

  if (!link) return false;
  return link.policy.allowFileSharing;
};

/**
 * Read access semantics for shared-channel history:
 * - Non-shared channels: channel member can read.
 * - Shared channels with ACTIVE link: channel member can read.
 * - Shared channels with revoked/inactive link: only host-workspace members can read.
 */
export const canUserReadChannelHistory = async (
  channelId: string,
  userId: string
): Promise<boolean> => {
  const [channelMember, channel] = await Promise.all([
    prisma.channelMember.findFirst({
      where: { channelId, userId, isActive: true },
      select: { id: true },
    }),
    prisma.channel.findUnique({
      where: { id: channelId },
      select: { workspaceId: true, collaborationId: true },
    }),
  ]);

  if (!channel || !channelMember) return false;
  if (!channel.collaborationId) return true;

  const activeLink = await prisma.workspaceCollaboration.findFirst({
    where: { id: channel.collaborationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (activeLink) return true;

  const hostWorkspaceMember = await prisma.member.findFirst({
    where: { userId, workspaceId: channel.workspaceId, isActive: true },
    select: { id: true },
  });
  return !!hostWorkspaceMember;
};

/**
 * Read access semantics for DM history:
 * - Same-workspace DMs: active participant can read.
 * - Cross-workspace DMs with ACTIVE link: active participant can read.
 * - Cross-workspace DMs with revoked/inactive link: only source-workspace members can read.
 */
export const canUserReadConversationHistory = async (
  conversationId: string,
  userId: string
): Promise<boolean> => {
  const [participant, conversation] = await Promise.all([
    prisma.conversationParticipant.findFirst({
      where: { conversationId, userId, isActive: true },
      select: { id: true },
    }),
    prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { workspaceId: true, collaborationId: true },
    }),
  ]);

  if (!conversation || !participant) return false;
  if (!conversation.collaborationId) return true;

  const dmReadable = await isCollaborationDmMutationAllowedForConversation(conversationId);
  if (dmReadable) return true;

  const sourceWorkspaceMember = await prisma.member.findFirst({
    where: { userId, workspaceId: conversation.workspaceId, isActive: true },
    select: { id: true },
  });
  return !!sourceWorkspaceMember;
};
