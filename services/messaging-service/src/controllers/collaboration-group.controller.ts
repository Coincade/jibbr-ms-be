import { Request, Response } from "express";
import { z, ZodError } from "zod";
import { Prisma } from "@jibbr/database";
import prisma from "../config/database.js";
import { formatError } from "../helper.js";
import { isWorkspaceAdmin } from "../helpers/collaborationAccess.js";
import { cleanupGroupMembershipArtifacts } from "../helpers/collaborationRevokeCleanup.js";
import {
  publishChannelEvent,
  publishCollaborationInvalidate,
} from "../services/streams-publisher.service.js";
import { NotificationService } from "../services/notification.service.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  ownerWorkspaceId: z.string().min(1),
  policy: z
    .object({
      allowExternalDiscovery: z.boolean().optional(),
      allowCrossWorkspaceDm: z.boolean().optional(),
      allowSharedChannels: z.boolean().optional(),
      allowFileSharing: z.boolean().optional(),
    })
    .optional(),
});

const inviteWorkspaceSchema = z.object({
  targetWorkspaceSlug: z.string().min(1),
  workspaceId: z.string().min(1),
});

const membershipWorkspaceSchema = z.object({
  workspaceId: z.string().min(1),
});

const createGroupChannelSchema = z.object({
  name: z.string().min(1).max(80),
  ownerWorkspaceId: z.string().min(1),
  type: z.enum(["PUBLIC", "PRIVATE"]).optional(),
  description: z.string().trim().max(2000).optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const writeAudit = async (
  groupId: string,
  actorUserId: string,
  eventType: string,
  eventPayload?: Record<string, unknown>
) => {
  await prisma.collaborationGroupAuditLog.create({
    data: {
      groupId,
      actorUserId,
      eventType,
      eventPayload: (eventPayload ?? {}) as Prisma.InputJsonValue,
    },
  });
};

const getGroupWithMemberships = (groupId: string) =>
  prisma.collaborationGroup.findFirst({
    where: { id: groupId },
    include: {
      policy: true,
      memberships: {
        include: {
          workspace: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

const getActiveMemberWorkspaceIds = async (groupId: string): Promise<string[]> => {
  const memberships = await prisma.collaborationGroupMembership.findMany({
    where: { groupId, status: "ACTIVE" },
    select: { workspaceId: true },
  });
  return memberships.map((m) => m.workspaceId);
};

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * POST /collaboration-groups
 * Any workspace admin can create a group. They become the OWNER.
 */
export const createGroup = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const payload = createGroupSchema.parse(req.body);

    const canCreate = await isWorkspaceAdmin(user.id, payload.ownerWorkspaceId);
    if (!canCreate) {
      return res.status(403).json({ message: "Only workspace admins can create a collaboration group" });
    }

    const policy = await prisma.collaborationPolicy.create({
      data: {
        name: `${payload.name} Policy`,
        createdByUserId: user.id,
        allowExternalDiscovery: payload.policy?.allowExternalDiscovery ?? true,
        allowCrossWorkspaceDm: payload.policy?.allowCrossWorkspaceDm ?? true,
        allowSharedChannels: payload.policy?.allowSharedChannels ?? true,
        allowFileSharing: payload.policy?.allowFileSharing ?? false,
      },
    });

    const group = await prisma.collaborationGroup.create({
      data: {
        name: payload.name,
        policyId: policy.id,
        createdByUserId: user.id,
        memberships: {
          create: {
            workspaceId: payload.ownerWorkspaceId,
            role: "OWNER",
            status: "ACTIVE",
            invitedByUserId: user.id,
            joinedAt: new Date(),
          },
        },
      },
      include: {
        policy: true,
        memberships: {
          include: { workspace: { select: { id: true, name: true, slug: true } } },
        },
      },
    });

    await writeAudit(group.id, user.id, "GROUP_CREATED", { ownerWorkspaceId: payload.ownerWorkspaceId });

    return res.status(201).json({ message: "Collaboration group created", data: group });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(422).json({ message: "Invalid data", errors: formatError(error) });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * POST /collaboration-groups/:id/invite
 * Group OWNER invites another workspace by slug.
 */
export const inviteWorkspace = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const groupId = req.params.id;
    const payload = inviteWorkspaceSchema.parse(req.body);

    const group = await prisma.collaborationGroup.findFirst({
      where: { id: groupId, status: "ACTIVE" },
      include: { memberships: true },
    });
    if (!group) return res.status(404).json({ message: "Collaboration group not found" });

    const ownerMembership = group.memberships.find(
      (m) => m.workspaceId === payload.workspaceId && m.role === "OWNER" && m.status === "ACTIVE"
    );
    if (!ownerMembership) {
      return res.status(403).json({ message: "Only the group owner can invite workspaces" });
    }

    const isOwnerAdmin = await isWorkspaceAdmin(user.id, payload.workspaceId);
    if (!isOwnerAdmin) {
      return res.status(403).json({ message: "Only workspace admins can send group invitations" });
    }

    const targetWorkspace = await prisma.workspace.findFirst({
      where: {
        slug: payload.targetWorkspaceSlug.toLowerCase(),
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, name: true, slug: true },
    });
    if (!targetWorkspace) {
      return res.status(404).json({ message: "Target workspace not found" });
    }
    if (targetWorkspace.id === payload.workspaceId) {
      return res.status(400).json({ message: "Cannot invite your own workspace" });
    }

    const existing = group.memberships.find((m) => m.workspaceId === targetWorkspace.id);
    if (existing && existing.status !== "REVOKED") {
      return res.status(409).json({ message: "Workspace is already a member or has a pending invite" });
    }

    const membership = existing
      ? await prisma.collaborationGroupMembership.update({
          where: { id: existing.id },
          data: { status: "INVITED", respondedAt: null, joinedAt: null, invitedByUserId: user.id },
        })
      : await prisma.collaborationGroupMembership.create({
          data: {
            groupId,
            workspaceId: targetWorkspace.id,
            role: "MEMBER",
            status: "INVITED",
            invitedByUserId: user.id,
          },
        });

    await writeAudit(groupId, user.id, "WORKSPACE_INVITED", {
      targetWorkspaceId: targetWorkspace.id,
      targetWorkspaceSlug: targetWorkspace.slug,
    });

    const ownerWorkspace = await prisma.workspace.findUnique({
      where: { id: payload.workspaceId },
      select: { name: true },
    });
    NotificationService.notifyCollaborationAdmins(
      targetWorkspace.id,
      user.id,
      "COLLABORATION_REQUEST",
      "Group collaboration invite",
      `${ownerWorkspace?.name ?? "A workspace"} has invited your workspace to join "${group.name}".`,
      { groupId, membershipId: membership.id }
    ).catch((err) => console.error("[Notifications] group invite:", err));

    publishCollaborationInvalidate({
      workspaceIds: [payload.workspaceId, targetWorkspace.id],
      reason: "group_invite_sent",
      collaborationId: groupId,
    }).catch((err) => console.error("[Streams] group invite:", err));

    return res.status(201).json({ message: "Invitation sent", data: membership });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(422).json({ message: "Invalid data", errors: formatError(error) });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * POST /collaboration-groups/:id/accept
 * Admin of the invited workspace accepts the invite.
 */
export const acceptGroupInvite = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const groupId = req.params.id;
    const payload = membershipWorkspaceSchema.parse(req.body);

    const canAccept = await isWorkspaceAdmin(user.id, payload.workspaceId);
    if (!canAccept) {
      return res.status(403).json({ message: "Only workspace admins can accept group invitations" });
    }

    const membership = await prisma.collaborationGroupMembership.findUnique({
      where: { groupId_workspaceId: { groupId, workspaceId: payload.workspaceId } },
    });
    if (!membership || membership.status !== "INVITED") {
      return res.status(404).json({ message: "No pending invitation found for this workspace" });
    }

    const updated = await prisma.collaborationGroupMembership.update({
      where: { id: membership.id },
      data: { status: "ACTIVE", respondedAt: new Date(), joinedAt: new Date() },
    });

    await writeAudit(groupId, user.id, "WORKSPACE_JOINED", { workspaceId: payload.workspaceId });

    const group = await prisma.collaborationGroup.findUnique({
      where: { id: groupId },
      select: { name: true },
    });
    const ownerMembership = await prisma.collaborationGroupMembership.findFirst({
      where: { groupId, role: "OWNER", status: "ACTIVE" },
      select: { workspaceId: true },
    });
    if (ownerMembership) {
      const joiningWorkspace = await prisma.workspace.findUnique({
        where: { id: payload.workspaceId },
        select: { name: true },
      });
      NotificationService.notifyCollaborationAdmins(
        ownerMembership.workspaceId,
        user.id,
        "COLLABORATION_APPROVED",
        "Workspace joined your network",
        `${joiningWorkspace?.name ?? "A workspace"} has joined "${group?.name ?? "your group"}".`,
        { groupId }
      ).catch((err) => console.error("[Notifications] group accept:", err));
    }

    const allMemberIds = await getActiveMemberWorkspaceIds(groupId);
    publishCollaborationInvalidate({
      workspaceIds: [...new Set([...allMemberIds, payload.workspaceId])],
      reason: "group_invite_accepted",
      collaborationId: groupId,
    }).catch((err) => console.error("[Streams] group accept:", err));

    return res.status(200).json({ message: "Invitation accepted", data: updated });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(422).json({ message: "Invalid data", errors: formatError(error) });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * POST /collaboration-groups/:id/reject
 * Admin of the invited workspace declines the invite.
 */
export const rejectGroupInvite = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const groupId = req.params.id;
    const payload = membershipWorkspaceSchema.parse(req.body);

    const canReject = await isWorkspaceAdmin(user.id, payload.workspaceId);
    if (!canReject) {
      return res.status(403).json({ message: "Only workspace admins can reject group invitations" });
    }

    const membership = await prisma.collaborationGroupMembership.findUnique({
      where: { groupId_workspaceId: { groupId, workspaceId: payload.workspaceId } },
    });
    if (!membership || membership.status !== "INVITED") {
      return res.status(404).json({ message: "No pending invitation found for this workspace" });
    }

    const updated = await prisma.collaborationGroupMembership.update({
      where: { id: membership.id },
      data: { status: "REVOKED", respondedAt: new Date() },
    });

    await writeAudit(groupId, user.id, "WORKSPACE_INVITE_REJECTED", { workspaceId: payload.workspaceId });

    const ownerMembership = await prisma.collaborationGroupMembership.findFirst({
      where: { groupId, role: "OWNER", status: "ACTIVE" },
      select: { workspaceId: true },
    });
    if (ownerMembership) {
      const rejectingWorkspace = await prisma.workspace.findUnique({
        where: { id: payload.workspaceId },
        select: { name: true },
      });
      const group = await prisma.collaborationGroup.findUnique({
        where: { id: groupId },
        select: { name: true },
      });
      NotificationService.notifyCollaborationAdmins(
        ownerMembership.workspaceId,
        user.id,
        "COLLABORATION_REVOKED",
        "Group invite declined",
        `${rejectingWorkspace?.name ?? "A workspace"} declined to join "${group?.name ?? "your group"}".`,
        { groupId }
      ).catch((err) => console.error("[Notifications] group reject:", err));
    }

    publishCollaborationInvalidate({
      workspaceIds: [payload.workspaceId],
      reason: "group_invite_rejected",
      collaborationId: groupId,
    }).catch((err) => console.error("[Streams] group reject:", err));

    return res.status(200).json({ message: "Invitation declined", data: updated });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(422).json({ message: "Invalid data", errors: formatError(error) });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * POST /collaboration-groups/:id/memberships/:workspaceId/revoke
 * Group OWNER removes a member workspace.
 */
export const revokeGroupMembership = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const groupId = req.params.id?.trim();
    const targetWorkspaceId = req.params.workspaceId?.trim();
    if (!groupId || !targetWorkspaceId) {
      return res.status(400).json({ message: "Invalid group or workspace id" });
    }

    const ownerMembership = await prisma.collaborationGroupMembership.findFirst({
      where: { groupId, role: "OWNER", status: "ACTIVE" },
    });
    if (!ownerMembership) {
      return res.status(404).json({ message: "Group not found" });
    }

    const isOwnerAdmin = await isWorkspaceAdmin(user.id, ownerMembership.workspaceId);
    if (!isOwnerAdmin) {
      return res.status(403).json({ message: "Only the group owner can remove workspaces" });
    }

    if (targetWorkspaceId === ownerMembership.workspaceId) {
      return res.status(400).json({ message: "Cannot remove the owner workspace from the group" });
    }

    const membership = await prisma.collaborationGroupMembership.findUnique({
      where: { groupId_workspaceId: { groupId, workspaceId: targetWorkspaceId } },
    });
    if (!membership || membership.status === "REVOKED") {
      return res.status(404).json({ message: "Active membership not found" });
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.collaborationGroupMembership.update({
          where: { id: membership.id },
          data: { status: "REVOKED", respondedAt: new Date() },
        });
        await cleanupGroupMembershipArtifacts(tx, groupId, targetWorkspaceId);
      },
      { maxWait: 10_000, timeout: 60_000 }
    );

    const updated = await prisma.collaborationGroupMembership.findUniqueOrThrow({
      where: { id: membership.id },
    });

    await writeAudit(groupId, user.id, "WORKSPACE_REMOVED", { removedWorkspaceId: targetWorkspaceId });

    const group = await prisma.collaborationGroup.findUnique({
      where: { id: groupId },
      select: { name: true },
    });
    const ownerWorkspace = await prisma.workspace.findUnique({
      where: { id: ownerMembership.workspaceId },
      select: { name: true },
    });
    NotificationService.notifyCollaborationAdmins(
      targetWorkspaceId,
      user.id,
      "COLLABORATION_REVOKED",
      "Removed from collaboration network",
      `${ownerWorkspace?.name ?? "A workspace"} has removed your workspace from "${group?.name ?? "the group"}".`,
      { groupId }
    ).catch((err) => console.error("[Notifications] group revoke membership:", err));

    const remainingMemberIds = await getActiveMemberWorkspaceIds(groupId);
    publishCollaborationInvalidate({
      workspaceIds: [...new Set([...remainingMemberIds, targetWorkspaceId])],
      reason: "group_membership_revoked",
      collaborationId: groupId,
    }).catch((err) => console.error("[Streams] group revoke membership:", err));

    return res.status(200).json({ message: "Workspace removed from group", data: updated });
  } catch (error) {
    console.error("[revokeGroupMembership]", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET /collaboration-groups
 * Returns all groups where any of the caller's workspaces has an ACTIVE or INVITED membership.
 */
export const listGroups = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const memberships = await prisma.member.findMany({
      where: { userId: user.id, isActive: true },
      select: { workspaceId: true },
    });
    const workspaceIds = memberships.map((m) => m.workspaceId);

    const groups = await prisma.collaborationGroup.findMany({
      where: {
        memberships: {
          some: {
            workspaceId: { in: workspaceIds },
            status: { in: ["ACTIVE", "INVITED"] },
          },
        },
      },
      include: {
        policy: true,
        memberships: {
          include: { workspace: { select: { id: true, name: true, slug: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return res.status(200).json({ message: "Groups fetched", data: groups });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET /collaboration-groups/:id
 * Returns full group detail. Caller must be a member (any status except revoked).
 */
export const getGroup = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const groupId = req.params.id;

    const userWorkspaceIds = (
      await prisma.member.findMany({
        where: { userId: user.id, isActive: true },
        select: { workspaceId: true },
      })
    ).map((m) => m.workspaceId);

    const group = await getGroupWithMemberships(groupId);
    if (!group) return res.status(404).json({ message: "Group not found" });

    const isMember = group.memberships.some(
      (m) => userWorkspaceIds.includes(m.workspaceId) && m.status !== "REVOKED"
    );
    if (!isMember) return res.status(403).json({ message: "Access denied" });

    return res.status(200).json({ message: "Group fetched", data: group });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * POST /collaboration-groups/:id/shared-channels
 * Creates a channel visible to all ACTIVE member workspaces in the group.
 */
export const createGroupSharedChannel = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const groupId = req.params.id;
    const payload = createGroupChannelSchema.parse(req.body);

    const group = await prisma.collaborationGroup.findFirst({
      where: { id: groupId, status: "ACTIVE" },
      include: { policy: true, memberships: { where: { status: "ACTIVE" } } },
    });
    if (!group) return res.status(404).json({ message: "Collaboration group not found" });
    if (!group.policy.allowSharedChannels) {
      return res.status(403).json({ message: "Shared channels are disabled by the group policy" });
    }

    const ownerMembership = group.memberships.find((m) => m.workspaceId === payload.ownerWorkspaceId);
    if (!ownerMembership) {
      return res.status(400).json({ message: "ownerWorkspaceId must be an active member of the group" });
    }

    const groupOwnerMembership = group.memberships.find((m) => m.role === "OWNER");
    const isGroupOwnerAdmin = groupOwnerMembership
      ? await isWorkspaceAdmin(user.id, groupOwnerMembership.workspaceId)
      : false;
    const isOwnerWorkspaceAdmin = await isWorkspaceAdmin(user.id, payload.ownerWorkspaceId);

    if (!isGroupOwnerAdmin && !isOwnerWorkspaceAdmin) {
      return res.status(403).json({ message: "Only group owner or workspace admins can create shared channels" });
    }

    const channel = await prisma.channel.create({
      data: {
        name: payload.name,
        type: payload.type ?? "PRIVATE",
        description: payload.description?.trim() || null,
        isBridgeChannel: false,
        workspaceId: payload.ownerWorkspaceId,
        groupId,
        channelAdminId: user.id,
        members: {
          create: { userId: user.id, isExternal: false },
        },
      },
    });

    await writeAudit(groupId, user.id, "GROUP_CHANNEL_CREATED", {
      channelId: channel.id,
      ownerWorkspaceId: payload.ownerWorkspaceId,
    });

    publishChannelEvent("channel.created", channel).catch((err) =>
      console.error("[Streams] group channel created:", err)
    );
    const allMemberIds = await getActiveMemberWorkspaceIds(groupId);
    publishCollaborationInvalidate({
      workspaceIds: allMemberIds,
      reason: "group_channel_created",
      collaborationId: groupId,
      channelId: channel.id,
    }).catch((err) => console.error("[Streams] group channel invalidate:", err));

    return res.status(201).json({ message: "Group shared channel created", data: channel });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(422).json({ message: "Invalid data", errors: formatError(error) });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};
