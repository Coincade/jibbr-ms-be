import {
  canUserMutateSharedChannel as canUserMutateSharedChannelDb,
  canUserReadChannelHistory as canUserReadChannelHistoryDb,
  isCollaborationDmMutationAllowedForConversation as isCollaborationDmMutationAllowedDb,
} from "@jibbr/database";
import prisma from "../config/database.js";

export type CollaborationResourceType = "workspace" | "channel" | "conversation" | "message";

export const canUserMutateSharedChannel = (userId: string, channelId: string) =>
  canUserMutateSharedChannelDb(prisma, userId, channelId);

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

/**
 * Returns the first active CollaborationGroup where both workspaces are ACTIVE members.
 * Used to check N-way access when pairwise links don't exist.
 */
export const findActiveGroupContainingBothWorkspaces = async (
  workspaceAId: string,
  workspaceBId: string
) => {
  return prisma.collaborationGroup.findFirst({
    where: {
      status: "ACTIVE",
      memberships: {
        some: { workspaceId: workspaceAId, status: "ACTIVE" },
      },
      AND: [
        {
          memberships: {
            some: { workspaceId: workspaceBId, status: "ACTIVE" },
          },
        },
      ],
    },
    include: { policy: true },
  });
};

/**
 * Returns true if userWorkspaceIds and resourceWorkspaceId share an active group
 * whose policy allows the given resource type.
 */
export const canAccessViaGroup = async (
  userWorkspaceIds: string[],
  resourceWorkspaceId: string,
  resourceType: CollaborationResourceType
): Promise<boolean> => {
  const groups = await prisma.collaborationGroup.findMany({
    where: {
      status: "ACTIVE",
      memberships: {
        some: { workspaceId: resourceWorkspaceId, status: "ACTIVE" },
      },
      AND: [
        {
          memberships: {
            some: { workspaceId: { in: userWorkspaceIds }, status: "ACTIVE" },
          },
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
  return groups.some((g) => isPolicyAllowedForResource(resourceType, g.policy));
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

  if (links.some((link) => isPolicyAllowedForResource(resourceType, link.policy))) return true;

  // Fall back to group membership: user's workspace and resourceWorkspaceId share an active group
  return canAccessViaGroup(userWorkspaceIds, resourceWorkspaceId, resourceType);
};

/**
 * Whether this DM conversation may be mutated (send, edit, delete, react, forward-in).
 * Same-workspace DMs (no collaborationId) are always allowed.
 * Cross-workspace DMs require an ACTIVE link and allowCrossWorkspaceDm on the policy.
 */
export const isCollaborationDmMutationAllowedForConversation = (conversationId: string) =>
  isCollaborationDmMutationAllowedDb(prisma, conversationId);

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
export const canUserReadChannelHistory = (channelId: string, userId: string) =>
  canUserReadChannelHistoryDb(prisma, channelId, userId);

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
      select: { workspaceId: true, collaborationId: true, groupId: true },
    }),
  ]);

  if (!conversation || !participant) return false;
  if (!conversation.collaborationId && !conversation.groupId) return true;

  const dmReadable = await isCollaborationDmMutationAllowedForConversation(conversationId);
  if (dmReadable) return true;

  const sourceWorkspaceMember = await prisma.member.findFirst({
    where: { userId, workspaceId: conversation.workspaceId, isActive: true },
    select: { id: true },
  });
  return !!sourceWorkspaceMember;
};
