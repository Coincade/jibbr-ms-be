import { Request, Response } from "express";
import { z, ZodError } from "zod";
import { Prisma } from "@jibbr/database";
import prisma from "../config/database.js";
import { formatError } from "../helper.js";
import {
  canAccessWorkspaceResource,
  findActiveCollaborationBetweenWorkspaces,
  isWorkspaceAdmin,
} from "../helpers/collaborationAccess.js";
import { cleanupPairwiseCollaborationArtifacts } from "../helpers/collaborationRevokeCleanup.js";
import {
  publishChannelEvent,
  publishCollaborationInvalidate,
} from "../services/streams-publisher.service.js";
import { NotificationService } from "../services/notification.service.js";

const requestSchema = z
  .object({
    requestingWorkspaceId: z.string().min(1),
    targetWorkspaceId: z.string().min(1).optional(),
    targetWorkspaceSlug: z.string().min(1).optional(),
    targetWorkspaceName: z.string().min(1).optional(),
    message: z.string().trim().max(1000).optional(),
    policyTemplate: z
      .object({
        allowExternalDiscovery: z.boolean().optional(),
        allowCrossWorkspaceDm: z.boolean().optional(),
        allowSharedChannels: z.boolean().optional(),
        allowFileSharing: z.boolean().optional(),
      })
      .optional(),
  })
  .refine((value) => Boolean(value.targetWorkspaceId || value.targetWorkspaceSlug || value.targetWorkspaceName), {
    message: "Provide targetWorkspaceId, targetWorkspaceSlug, or targetWorkspaceName",
    path: ["targetWorkspaceSlug"],
  });

const createSharedChannelSchema = z.object({
  name: z.string().min(1).max(80),
  ownerWorkspaceId: z.string().min(1),
  type: z.enum(["PUBLIC", "PRIVATE"]).optional(),
  description: z.string().trim().max(2000).optional(),
});

const createExternalDmSchema = z.object({
  sourceWorkspaceId: z.string().min(1),
  targetUserId: z.string().min(1),
});

const writeAudit = async (
  collaborationId: string,
  actorUserId: string,
  eventType: string,
  eventPayload?: Record<string, unknown>
) => {
  await prisma.collaborationAuditLog.create({
    data: {
      collaborationId,
      actorUserId,
      eventType,
      eventPayload: (eventPayload ?? {}) as Prisma.InputJsonValue,
    },
  });
};

export const createCollaborationRequest = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const payload = requestSchema.parse(req.body);
    let targetWorkspace = null as null | { id: string; slug: string; name: string };
    if (payload.targetWorkspaceId) {
      targetWorkspace = await prisma.workspace.findFirst({
        where: {
          id: payload.targetWorkspaceId,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true, slug: true, name: true },
      });
    }

    // Primary friendly path: slug
    if (!targetWorkspace && payload.targetWorkspaceSlug) {
      targetWorkspace = await prisma.workspace.findFirst({
        where: {
          slug: payload.targetWorkspaceSlug.toLowerCase(),
          isActive: true,
          deletedAt: null,
        },
        select: { id: true, slug: true, name: true },
      });
    }

    // Fallback path: treat targetWorkspaceSlug as display name if slug lookup fails
    if (!targetWorkspace && payload.targetWorkspaceSlug) {
      const byName = await prisma.workspace.findMany({
        where: {
          name: {
            equals: payload.targetWorkspaceSlug.trim(),
            mode: "insensitive",
          },
          isActive: true,
          deletedAt: null,
        },
        select: { id: true, slug: true, name: true },
      });
      if (byName.length > 1) {
        return res.status(409).json({
          message:
            "Multiple workspaces matched this name. Use targetWorkspaceSlug for a unique match.",
        });
      }
      targetWorkspace = byName[0] ?? null;
    }

    // Explicit targetWorkspaceName support
    if (!targetWorkspace && payload.targetWorkspaceName) {
      const byName = await prisma.workspace.findMany({
        where: {
          name: {
            equals: payload.targetWorkspaceName.trim(),
            mode: "insensitive",
          },
          isActive: true,
          deletedAt: null,
        },
        select: { id: true, slug: true, name: true },
      });
      if (byName.length > 1) {
        return res.status(409).json({
          message:
            "Multiple workspaces matched this name. Use targetWorkspaceSlug for a unique match.",
        });
      }
      targetWorkspace = byName[0] ?? null;
    }

    if (!targetWorkspace) {
      return res.status(404).json({ message: "Target workspace not found" });
    }

    if (payload.requestingWorkspaceId === targetWorkspace.id) {
      return res.status(400).json({ message: "Cannot collaborate with the same workspace" });
    }

    const isRequesterAdmin = await isWorkspaceAdmin(user.id, payload.requestingWorkspaceId);
    if (!isRequesterAdmin) {
      return res.status(403).json({ message: "Only workspace admins can send collaboration requests" });
    }

    const activeLink = await findActiveCollaborationBetweenWorkspaces(
      payload.requestingWorkspaceId,
      targetWorkspace.id
    );
    if (activeLink) {
      return res.status(400).json({ message: "An active collaboration already exists for this workspace pair" });
    }

    const existingPending = await prisma.workspaceCollaborationRequest.findFirst({
      where: {
        status: "PENDING",
        OR: [
          {
            requestingWorkspaceId: payload.requestingWorkspaceId,
            targetWorkspaceId: targetWorkspace.id,
          },
          {
            requestingWorkspaceId: targetWorkspace.id,
            targetWorkspaceId: payload.requestingWorkspaceId,
          },
        ],
      },
      select: { id: true },
    });
    if (existingPending) {
      return res.status(409).json({ message: "A pending collaboration request already exists" });
    }

    const collaborationRequest = await prisma.workspaceCollaborationRequest.create({
      data: {
        requestingWorkspaceId: payload.requestingWorkspaceId,
        targetWorkspaceId: targetWorkspace.id,
        requestedByUserId: user.id,
        message: payload.message,
        policyTemplate: payload.policyTemplate ?? {},
      },
    });

    publishCollaborationInvalidate({
      workspaceIds: [payload.requestingWorkspaceId, targetWorkspace.id],
      reason: "request_created",
      requestId: collaborationRequest.id,
    }).catch((err) => console.error("[Streams] collaboration invalidate (request_created):", err));

    const requestingWorkspace = await prisma.workspace.findUnique({
      where: { id: payload.requestingWorkspaceId },
      select: { name: true },
    });
    NotificationService.notifyCollaborationAdmins(
      targetWorkspace.id,
      user.id,
      'COLLABORATION_REQUEST',
      'New collaboration request',
      `${requestingWorkspace?.name ?? 'Another workspace'} has sent a collaboration request.`,
      { requestId: collaborationRequest.id, requestingWorkspaceId: payload.requestingWorkspaceId }
    ).catch((err) => console.error("[Notifications] collaboration request:", err));

    return res.status(201).json({
      message: "Collaboration request created",
      data: collaborationRequest,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(422).json({ message: "Invalid data", errors: formatError(error) });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getCollaborationRequestInbox = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const adminMemberships = await prisma.member.findMany({
      where: { userId: user.id, isActive: true, role: "ADMIN" },
      select: { workspaceId: true },
    });
    const workspaceIds = adminMemberships.map((membership) => membership.workspaceId);

    const requests = await prisma.workspaceCollaborationRequest.findMany({
      where: {
        targetWorkspaceId: { in: workspaceIds },
      },
      include: {
        requestingWorkspace: { select: { id: true, name: true } },
        targetWorkspace: { select: { id: true, name: true, slug: true } },
        requestedBy: { select: { id: true, name: true, email: true } },
        respondedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { requestedAt: "desc" },
    });

    return res.status(200).json({ message: "Collaboration inbox fetched", data: requests });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getCollaborationRequestOutbox = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const requests = await prisma.workspaceCollaborationRequest.findMany({
      where: { requestedByUserId: user.id },
      include: {
        requestingWorkspace: { select: { id: true, name: true } },
        targetWorkspace: { select: { id: true, name: true, slug: true } },
        respondedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { requestedAt: "desc" },
    });

    return res.status(200).json({ message: "Collaboration outbox fetched", data: requests });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const approveCollaborationRequest = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const requestId = req.params.id;
    const request = await prisma.workspaceCollaborationRequest.findFirst({
      where: { id: requestId },
    });
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "PENDING") {
      return res.status(400).json({ message: "Only pending requests can be approved" });
    }

    const canApprove = await isWorkspaceAdmin(user.id, request.targetWorkspaceId);
    if (!canApprove) {
      return res.status(403).json({ message: "Only target workspace admins can approve this request" });
    }

    const existingLink = await findActiveCollaborationBetweenWorkspaces(
      request.requestingWorkspaceId,
      request.targetWorkspaceId
    );
    if (existingLink) {
      return res.status(409).json({ message: "An active collaboration already exists" });
    }

    const template = (request.policyTemplate ?? {}) as Record<string, boolean>;
    const policy = await prisma.collaborationPolicy.create({
      data: {
        name: `Policy ${request.requestingWorkspaceId.slice(0, 6)}-${request.targetWorkspaceId.slice(0, 6)}`,
        createdByUserId: user.id,
        allowExternalDiscovery: template.allowExternalDiscovery ?? true,
        allowCrossWorkspaceDm: template.allowCrossWorkspaceDm ?? true,
        allowSharedChannels: template.allowSharedChannels ?? true,
        allowFileSharing: template.allowFileSharing ?? false,
      },
    });

    const pair = [request.requestingWorkspaceId, request.targetWorkspaceId].sort();

    const collaboration = await prisma.workspaceCollaboration.create({
      data: {
        workspaceAId: pair[0],
        workspaceBId: pair[1],
        policyId: policy.id,
        acceptedAt: new Date(),
        createdFromRequestId: request.id,
      },
      include: {
        policy: true,
      },
    });

    await prisma.workspaceCollaborationRequest.update({
      where: { id: request.id },
      data: {
        status: "ACCEPTED",
        respondedAt: new Date(),
        respondedByUserId: user.id,
        collaborationId: collaboration.id,
      },
    });

    await writeAudit(collaboration.id, user.id, "COLLABORATION_APPROVED", {
      requestId: request.id,
    });

    publishCollaborationInvalidate({
      workspaceIds: [request.requestingWorkspaceId, request.targetWorkspaceId],
      reason: "link_approved",
      collaborationId: collaboration.id,
      requestId: request.id,
    }).catch((err) => console.error("[Streams] collaboration invalidate (link_approved):", err));

    const approvingWorkspace = await prisma.workspace.findUnique({
      where: { id: request.targetWorkspaceId },
      select: { name: true },
    });
    NotificationService.notifyCollaborationAdmins(
      request.requestingWorkspaceId,
      user.id,
      'COLLABORATION_APPROVED',
      'Collaboration request approved',
      `${approvingWorkspace?.name ?? 'Another workspace'} has approved your collaboration request.`,
      { collaborationId: collaboration.id, requestId: request.id }
    ).catch((err) => console.error("[Notifications] collaboration approved:", err));

    return res.status(200).json({ message: "Collaboration approved", data: collaboration });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const rejectCollaborationRequest = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const requestId = req.params.id;
    const request = await prisma.workspaceCollaborationRequest.findFirst({
      where: { id: requestId },
    });
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "PENDING") {
      return res.status(400).json({ message: "Only pending requests can be rejected" });
    }

    const canReject = await isWorkspaceAdmin(user.id, request.targetWorkspaceId);
    if (!canReject) {
      return res.status(403).json({ message: "Only target workspace admins can reject this request" });
    }

    const updated = await prisma.workspaceCollaborationRequest.update({
      where: { id: request.id },
      data: {
        status: "REJECTED",
        respondedAt: new Date(),
        respondedByUserId: user.id,
      },
    });

    publishCollaborationInvalidate({
      workspaceIds: [request.requestingWorkspaceId, request.targetWorkspaceId],
      reason: "request_rejected",
      requestId: request.id,
    }).catch((err) => console.error("[Streams] collaboration invalidate (request_rejected):", err));

    const rejectingWorkspace = await prisma.workspace.findUnique({
      where: { id: request.targetWorkspaceId },
      select: { name: true },
    });
    NotificationService.notifyCollaborationAdmins(
      request.requestingWorkspaceId,
      user.id,
      'COLLABORATION_REVOKED',
      'Collaboration request declined',
      `${rejectingWorkspace?.name ?? 'Another workspace'} has declined your collaboration request.`,
      { requestId: request.id }
    ).catch((err) => console.error("[Notifications] collaboration rejected:", err));

    return res.status(200).json({ message: "Collaboration request rejected", data: updated });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const listWorkspaceCollaborations = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const memberships = await prisma.member.findMany({
      where: { userId: user.id, isActive: true },
      select: { workspaceId: true },
    });
    const workspaceIds = memberships.map((membership) => membership.workspaceId);

    const links = await prisma.workspaceCollaboration.findMany({
      where: {
        OR: [{ workspaceAId: { in: workspaceIds } }, { workspaceBId: { in: workspaceIds } }],
      },
      include: {
        workspaceA: { select: { id: true, name: true } },
        workspaceB: { select: { id: true, name: true } },
        policy: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    return res.status(200).json({ message: "Collaborations fetched", data: links });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const revokeCollaborationLink = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const linkId = req.params.id;
    const link = await prisma.workspaceCollaboration.findFirst({
      where: { id: linkId, status: "ACTIVE" },
    });
    if (!link) return res.status(404).json({ message: "Active collaboration link not found" });

    const [canRevokeA, canRevokeB] = await Promise.all([
      isWorkspaceAdmin(user.id, link.workspaceAId),
      isWorkspaceAdmin(user.id, link.workspaceBId),
    ]);
    if (!canRevokeA && !canRevokeB) {
      return res.status(403).json({ message: "Only admins of linked workspaces can revoke this collaboration" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.workspaceCollaboration.update({
        where: { id: link.id },
        data: {
          status: "REVOKED",
          revokedAt: new Date(),
          revokedByUserId: user.id,
        },
      });

      await tx.workspaceCollaborationRequest.updateMany({
        where: { collaborationId: link.id, status: "ACCEPTED" },
        data: { status: "REVOKED", respondedAt: new Date(), respondedByUserId: user.id },
      });

      await cleanupPairwiseCollaborationArtifacts(tx, link.id);
    });

    const updated = await prisma.workspaceCollaboration.findUniqueOrThrow({
      where: { id: link.id },
    });

    await writeAudit(link.id, user.id, "COLLABORATION_REVOKED", {});

    publishCollaborationInvalidate({
      workspaceIds: [link.workspaceAId, link.workspaceBId],
      reason: "link_revoked",
      collaborationId: link.id,
    }).catch((err) => console.error("[Streams] collaboration invalidate (link_revoked):", err));

    // Determine which workspace the actor belongs to so we can notify the other side.
    const revokerWorkspaceId = canRevokeA ? link.workspaceAId : link.workspaceBId;
    const otherWorkspaceId = revokerWorkspaceId === link.workspaceAId ? link.workspaceBId : link.workspaceAId;
    const revokerWorkspace = await prisma.workspace.findUnique({
      where: { id: revokerWorkspaceId },
      select: { name: true },
    });
    NotificationService.notifyCollaborationAdmins(
      otherWorkspaceId,
      user.id,
      'COLLABORATION_REVOKED',
      'Collaboration link revoked',
      `${revokerWorkspace?.name ?? 'Another workspace'} has revoked the collaboration link.`,
      { collaborationId: link.id }
    ).catch((err) => console.error("[Notifications] collaboration revoked:", err));

    return res.status(200).json({ message: "Collaboration revoked", data: updated });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createSharedChannel = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const linkId = req.params.id;
    const payload = createSharedChannelSchema.parse(req.body);

    const link = await prisma.workspaceCollaboration.findFirst({
      where: { id: linkId, status: "ACTIVE" },
      include: { policy: true },
    });
    if (!link) return res.status(404).json({ message: "Collaboration not found" });
    if (!link.policy.allowSharedChannels) {
      return res.status(403).json({ message: "Shared channels are disabled for this collaboration" });
    }

    if (![link.workspaceAId, link.workspaceBId].includes(payload.ownerWorkspaceId)) {
      return res.status(400).json({ message: "ownerWorkspaceId must belong to the collaboration pair" });
    }

    const [isAdminInA, isAdminInB] = await Promise.all([
      isWorkspaceAdmin(user.id, link.workspaceAId),
      isWorkspaceAdmin(user.id, link.workspaceBId),
    ]);
    if (!isAdminInA && !isAdminInB) {
      return res.status(403).json({ message: "Only linked workspace admins can create shared channels" });
    }

    const channel = await prisma.channel.create({
      data: {
        name: payload.name,
        type: payload.type ?? "PRIVATE",
        description: payload.description?.trim() || null,
        isBridgeChannel: false,
        workspaceId: payload.ownerWorkspaceId,
        collaborationId: link.id,
        channelAdminId: user.id,
        members: {
          create: {
            userId: user.id,
            isExternal: false,
          },
        },
      },
    });

    await writeAudit(link.id, user.id, "SHARED_CHANNEL_CREATED", {
      channelId: channel.id,
      ownerWorkspaceId: payload.ownerWorkspaceId,
    });

    publishChannelEvent("channel.created", channel).catch((err) =>
      console.error("[Streams] Failed to publish channel.created (shared):", err)
    );
    publishCollaborationInvalidate({
      workspaceIds: [link.workspaceAId, link.workspaceBId],
      reason: "shared_channel_created",
      collaborationId: link.id,
      channelId: channel.id,
    }).catch((err) => console.error("[Streams] collaboration invalidate (shared_channel_created):", err));

    return res.status(201).json({ message: "Shared channel created", data: channel });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(422).json({ message: "Invalid data", errors: formatError(error) });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createExternalDirectMessage = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const linkId = req.params.id;
    const payload = createExternalDmSchema.parse(req.body);

    const link = await prisma.workspaceCollaboration.findFirst({
      where: { id: linkId, status: "ACTIVE" },
      include: { policy: true },
    });
    if (!link) return res.status(404).json({ message: "Collaboration not found" });
    if (!link.policy.allowCrossWorkspaceDm) {
      return res.status(403).json({ message: "Cross-workspace DM is disabled for this collaboration" });
    }

    if (![link.workspaceAId, link.workspaceBId].includes(payload.sourceWorkspaceId)) {
      return res.status(400).json({ message: "sourceWorkspaceId must belong to the collaboration pair" });
    }

    const canAccessSourceWorkspace = await canAccessWorkspaceResource(
      user.id,
      payload.sourceWorkspaceId,
      "conversation"
    );
    if (!canAccessSourceWorkspace) {
      return res.status(403).json({ message: "You do not have access to this workspace for DM creation" });
    }

    const sourceMember = await prisma.member.findFirst({
      where: { userId: user.id, workspaceId: payload.sourceWorkspaceId, isActive: true },
      select: { id: true },
    });
    if (!sourceMember) {
      return res.status(403).json({ message: "You must be an active member of source workspace" });
    }

    const targetMember = await prisma.member.findFirst({
      where: {
        userId: payload.targetUserId,
        workspaceId: {
          in: [link.workspaceAId, link.workspaceBId].filter((workspaceId) => workspaceId !== payload.sourceWorkspaceId),
        },
        isActive: true,
      },
      select: { userId: true },
    });
    if (!targetMember) {
      return res.status(404).json({ message: "Target user is not an active member of the linked workspace" });
    }

    const existingConversation = await prisma.conversation.findFirst({
      where: {
        collaborationId: link.id,
        participants: {
          every: {
            userId: {
              in: [user.id, payload.targetUserId],
            },
            isActive: true,
          },
        },
      },
      include: {
        participants: true,
      },
    });

    if (existingConversation && existingConversation.participants.length === 2) {
      return res.status(200).json({ message: "Conversation found", data: existingConversation });
    }

    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: payload.sourceWorkspaceId,
        collaborationId: link.id,
        participants: {
          create: [{ userId: user.id }, { userId: payload.targetUserId }],
        },
      },
      include: {
        participants: true,
      },
    });

    await writeAudit(link.id, user.id, "EXTERNAL_DM_CREATED", {
      conversationId: conversation.id,
      targetUserId: payload.targetUserId,
    });

    publishCollaborationInvalidate({
      workspaceIds: [link.workspaceAId, link.workspaceBId],
      reason: "external_dm_created",
      collaborationId: link.id,
      conversationId: conversation.id,
    }).catch((err) => console.error("[Streams] collaboration invalidate (external_dm_created):", err));

    return res.status(201).json({ message: "External DM created", data: conversation });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(422).json({ message: "Invalid data", errors: formatError(error) });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};
