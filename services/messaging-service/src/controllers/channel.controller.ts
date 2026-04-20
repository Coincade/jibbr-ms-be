import { Request, Response } from "express";
import { randomUUID } from "crypto";
import prisma from "../config/database.js";
import { formatError, canUserSendAttachmentsToChannel } from "../helper.js";
import { ZodError } from "zod";
import { z } from "zod";
import { publishChannelEvent } from "../services/streams-publisher.service.js";

const createChannelSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["PUBLIC", "PRIVATE"]),
  workspaceId: z.string(),
  image: z.string().optional(),
  description: z.string().trim().max(2000).optional()
});

const joinChannelSchema = z.object({
  channelId: z.string()
});

const addMemberToChannelSchema = z.object({
  userId: z.string(),
  channelId: z.string()
});

const updateChannelSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(["PUBLIC", "PRIVATE"]).optional(),
  image: z.string().optional(),
  description: z.string().trim().max(2000).optional()
});

const CHANNEL_ASSET_PREVIEW_LIMIT = 6;
const linkRegex = /https?:\/\/[^\s<>"')]+/gi;

function normalizeOptionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isMediaMimeType(mimeType?: string | null) {
  if (!mimeType) return false;
  return mimeType.startsWith("image/") || mimeType.startsWith("video/");
}

function extractLinksFromText(content?: string | null) {
  if (!content) return [];
  const matches = content.match(linkRegex) ?? [];
  return Array.from(new Set(matches));
}

async function buildChannelDetailPayload(channelId: string, userId: string) {
  const channel = await prisma.channel.findFirst({
    where: {
      id: channelId,
      deletedAt: null
    },
    include: {
      workspace: true,
      mutedByUsers: {
        where: {
          userId
        },
        select: {
          id: true
        }
      },
      _count: {
        select: {
          members: {
            where: {
              isActive: true
            }
          },
          messages: {
            where: {
              deletedAt: null
            }
          }
        }
      },
      members: {
        where: {
          isActive: true
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
              email: true
            }
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });

  if (!channel) {
    return null;
  }

  const userChannelMembership = channel.members.find((m) => m.userId === userId);
  if (!userChannelMembership) {
    return { channel, isMember: false } as const;
  }

  const workspaceMembership = await prisma.member.findFirst({
    where: {
      userId,
      workspaceId: channel.workspaceId,
      isActive: true
    },
    select: {
      role: true
    }
  });

  const memberUserIds = channel.members.map((member) => member.userId);
  const workspaceMembers = memberUserIds.length > 0
    ? await prisma.member.findMany({
        where: {
          workspaceId: channel.workspaceId,
          userId: {
            in: memberUserIds
          },
          isActive: true
        },
        select: {
          userId: true,
          role: true
        }
      })
    : [];

  const roleByUserId = new Map(workspaceMembers.map((member) => [member.userId, member.role]));

  const attachmentMessages = await prisma.message.findMany({
    where: {
      channelId: channel.id,
      deletedAt: null,
      attachments: {
        some: {}
      }
    },
    select: {
      id: true,
      content: true,
      createdAt: true,
      userId: true,
      user: {
        select: {
          id: true,
          name: true,
          image: true
        }
      },
      attachments: {
        select: {
          id: true,
          filename: true,
          originalName: true,
          mimeType: true,
          size: true,
          url: true,
          createdAt: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 50
  });

  const linkMessages = await prisma.message.findMany({
    where: {
      channelId: channel.id,
      deletedAt: null,
      content: {
        contains: "http"
      }
    },
    select: {
      id: true,
      content: true,
      createdAt: true,
      userId: true,
      user: {
        select: {
          id: true,
          name: true,
          image: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 50
  });

  const media = attachmentMessages
    .flatMap((message) =>
      message.attachments
        .filter((attachment) => isMediaMimeType(attachment.mimeType))
        .map((attachment) => ({
          id: attachment.id,
          messageId: message.id,
          url: attachment.url,
          filename: attachment.originalName || attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          createdAt: attachment.createdAt.toISOString(),
          sender: message.user
        }))
    )
    .slice(0, CHANNEL_ASSET_PREVIEW_LIMIT);

  const files = attachmentMessages
    .flatMap((message) =>
      message.attachments
        .filter((attachment) => !isMediaMimeType(attachment.mimeType))
        .map((attachment) => ({
          id: attachment.id,
          messageId: message.id,
          url: attachment.url,
          filename: attachment.originalName || attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          createdAt: attachment.createdAt.toISOString(),
          sender: message.user
        }))
    )
    .slice(0, CHANNEL_ASSET_PREVIEW_LIMIT);

  const links = linkMessages
    .flatMap((message) =>
      extractLinksFromText(message.content).map((url) => ({
        id: `${message.id}:${url}`,
        messageId: message.id,
        url,
        createdAt: message.createdAt.toISOString(),
        sender: message.user
      }))
    )
    .slice(0, CHANNEL_ASSET_PREVIEW_LIMIT);

  const canSendAttachments = await canUserSendAttachmentsToChannel(channel.id, userId);
  const currentUserRole = workspaceMembership?.role ?? null;
  const isChannelCreator = channel.channelAdminId === userId;
  const isWorkspaceAdmin = currentUserRole === "ADMIN" || currentUserRole === "MODERATOR";
  const isProtectedChannel = ["general", "townhall"].includes(channel.name.toLowerCase());
  const canEdit = !isProtectedChannel && (isChannelCreator || isWorkspaceAdmin);
  const canManageMembers = !isProtectedChannel && (isChannelCreator || isWorkspaceAdmin);
  const canLeave = !isProtectedChannel && !isChannelCreator;

  return {
    channel,
    isMember: true,
    data: {
      ...channel,
      description: channel.description,
      canSendAttachments,
      isMuted: channel.mutedByUsers.length > 0,
      memberCount: channel._count.members,
      messageCount: channel._count.messages,
      permissions: {
        canEdit,
        canManageMembers,
        canLeave,
        isChannelCreator,
        currentUserRole
      },
      members: channel.members.map((member) => ({
        ...member,
        workspaceRole: roleByUserId.get(member.userId) ?? null,
        isChannelCreator: member.userId === channel.channelAdminId
      })),
      preview: {
        media,
        files,
        links
      }
    }
  } as const;
}

export const createChannel = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const body = req.body;
    const payload = createChannelSchema.parse(body);

    // Check if user is a member of the workspace
    const member = await prisma.member.findFirst({
      where: {
        userId: user.id,
        workspaceId: payload.workspaceId,
        isActive: true
      }
    });

    if (!member) {
      return res.status(403).json({ message: "You are not a member of this workspace" });
    }

    const channel = await prisma.channel.create({
      data: {
        name: payload.name,
        description: normalizeOptionalText(payload.description),
        type: payload.type,
        workspaceId: payload.workspaceId,
        image: payload.image,
        channelAdminId: user.id,
        members: {
          create: {
            userId: user.id
          }
        }
      }
    });

    publishChannelEvent('channel.created', channel).catch((err) =>
      console.error('[Streams] Failed to publish channel.created event:', err)
    );

    return res.status(201).json({
      message: "Channel created successfully",
      data: channel
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getWorkspaceChannels = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const workspaceId = req.params.workspaceId;

    // Check if user is a member of the workspace
    const member = await prisma.member.findFirst({
      where: {
        userId: user.id,
        workspaceId: workspaceId,
        isActive: true
      }
    });

    if (!member) {
      return res.status(403).json({ message: "You are not a member of this workspace" });
    }

    // Get channels where user is a member (excluding soft-deleted and bridge channels)
    const channels = await prisma.channel.findMany({
      where: {
        workspaceId: workspaceId,
        deletedAt: null,
        isBridgeChannel: false,
        members: {
          some: {
            userId: user.id,
            isActive: true
          }
        }
      }
    });

    return res.status(200).json({
      message: "Channels fetched successfully",
      data: channels
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getChannel = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const channelId = req.params.id;

    const result = await buildChannelDetailPayload(channelId, user.id);

    if (!result) {
      return res.status(404).json({ message: "Channel not found" });
    }

    const { channel } = result;
    const member = await prisma.member.findFirst({
      where: {
        userId: user.id,
        workspaceId: channel.workspaceId,
        isActive: true
      }
    });

    if (!member) {
      return res.status(403).json({ message: "You are not a member of this workspace" });
    }

    if (!result.isMember) {
      return res.status(403).json({ message: "You are not a member of this channel" });
    }

    return res.status(200).json({
      message: "Channel fetched successfully",
      data: result.data,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const joinChannel = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const body = req.body;
    const payload = joinChannelSchema.parse(body);

    const channel = await prisma.channel.findFirst({
      where: {
        id: payload.channelId,
        deletedAt: null
      }
    });

    if (!channel) {
      return res.status(404).json({ message: "Channel not found" });
    }

    // Check if user is a member of the workspace
    const member = await prisma.member.findFirst({
      where: {
        userId: user.id,
        workspaceId: channel.workspaceId,
        isActive: true
      }
    });

    if (!member) {
      return res.status(403).json({ message: "You are not a member of this workspace" });
    }

    // Check if user is already an active member of the channel
    const existingChannelMember = await prisma.channelMember.findFirst({
      where: {
        userId: user.id,
        channelId: channel.id,
        isActive: true
      }
    });

    if (existingChannelMember) {
      return res.status(400).json({ message: "You are already a member of this channel" });
    }

    // Check if user was previously removed (soft-deleted membership) - reactivate instead of create
    const previouslyRemoved = await prisma.channelMember.findFirst({
      where: {
        userId: user.id,
        channelId: channel.id,
        isActive: false
      }
    });

    let channelMember;
    if (previouslyRemoved) {
      channelMember = await prisma.channelMember.update({
        where: { id: previouslyRemoved.id },
        data: { isActive: true }
      });
    } else {
      channelMember = await prisma.channelMember.create({
        data: {
          userId: user.id,
          channelId: channel.id
        }
      });
    }

    return res.status(200).json({
      message: "Joined channel successfully",
      data: channelMember
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const addMemberToChannel = async (req: Request, res: Response) => {
  console.log("addMemberToChannel function called");
  
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const body = req.body;
    const payload = addMemberToChannelSchema.parse(body);

    // Get the channel
    const channel = await prisma.channel.findFirst({
      where: {
        id: payload.channelId,
        deletedAt: null
      },
      include: {
        workspace: true
      }
    });

    if (!channel) {
      return res.status(404).json({ message: "Channel not found" });
    }

    // Check if the requesting user is a member of the workspace
    const requestingMember = await prisma.member.findFirst({
      where: {
        userId: user.id,
        workspaceId: channel.workspaceId,
        isActive: true
      }
    });

    if (!requestingMember) {
      return res.status(403).json({ message: "You are not a member of this workspace" });
    }

    // Bridge channel: admin, moderator, or channel creator can add same-workspace (same domain) users without email invite
    if (channel.isBridgeChannel) {
      const isChannelCreator = channel.channelAdminId === user.id;
      const isAdminOrMod = requestingMember.role === "ADMIN" || requestingMember.role === "MODERATOR";
      if (!isChannelCreator && !isAdminOrMod) {
        return res.status(403).json({ message: "Only the channel creator, workspace admin, or moderator can add members to this bridge channel" });
      }

      const requestingChannelMember = await prisma.channelMember.findFirst({
        where: { userId: user.id, channelId: channel.id, isActive: true }
      });
      if (!requestingChannelMember) {
        return res.status(403).json({ message: "You are not a member of this channel" });
      }

      const targetMember = await prisma.member.findFirst({
        where: { userId: payload.userId, workspaceId: channel.workspaceId, isActive: true }
      });
      if (!targetMember) {
        return res.status(400).json({ message: "User is not in this workspace. Only workspace members can be added from the popup; use email invite for external users." });
      }

      const existingActiveMember = await prisma.channelMember.findFirst({
        where: { userId: payload.userId, channelId: channel.id, isActive: true }
      });
      if (existingActiveMember) {
        return res.status(400).json({ message: "User is already a member of this channel" });
      }

      const inactiveMembership = await prisma.channelMember.findFirst({
        where: { userId: payload.userId, channelId: channel.id, isActive: false }
      });
      if (inactiveMembership) {
        await prisma.channelMember.updateMany({
          where: { userId: payload.userId, channelId: channel.id },
          data: { isActive: true, isExternal: false }
        });
        const updated = await prisma.channelMember.findFirst({
          where: { userId: payload.userId, channelId: channel.id }
        });
        return res.status(200).json({
          message: "Member added to channel successfully",
          data: updated ?? inactiveMembership
        });
      }

      const newChannelMember = await prisma.channelMember.create({
        data: {
          userId: payload.userId,
          channelId: channel.id,
          isExternal: false
        }
      });
      return res.status(200).json({
        message: "Member added to channel successfully",
        data: newChannelMember
      });
    }

    // Non-bridge: only private channels
    if (channel.type !== "PRIVATE") {
      return res.status(400).json({ message: "Can only add members to private channels" });
    }

    // Check if the requesting user is a member of the channel
    const requestingChannelMember = await prisma.channelMember.findFirst({
      where: {
        userId: user.id,
        channelId: channel.id,
        isActive: true
      }
    });

    if (!requestingChannelMember) {
      return res.status(403).json({ message: "You are not a member of this channel" });
    }

    // Check if the target user is a member of the workspace
    const targetMember = await prisma.member.findFirst({
      where: {
        userId: payload.userId,
        workspaceId: channel.workspaceId,
        isActive: true
      }
    });

    if (!targetMember) {
      return res.status(400).json({ message: "User is not a member of this workspace" });
    }

    // Check if the target user is already an active member of the channel
    const existingActiveMember = await prisma.channelMember.findFirst({
      where: {
        userId: payload.userId,
        channelId: channel.id,
        isActive: true
      }
    });

    if (existingActiveMember) {
      return res.status(400).json({ message: "User is already a member of this channel" });
    }

    // Check if they were previously removed (soft-deleted membership)
    const inactiveMembership = await prisma.channelMember.findFirst({
      where: {
        userId: payload.userId,
        channelId: channel.id,
        isActive: false
      }
    });

    if (inactiveMembership) {
      await prisma.channelMember.updateMany({
        where: { userId: payload.userId, channelId: channel.id },
        data: { isActive: true }
      });
      return res.status(200).json({
        message: "Member added to channel successfully",
        data: { ...inactiveMembership, isActive: true }
      });
    }

    // Add the user to the channel (new membership)
    const newChannelMember = await prisma.channelMember.create({
      data: {
        userId: payload.userId,
        channelId: channel.id
      }
    });

    return res.status(200).json({
      message: "Member added to channel successfully",
      data: newChannelMember
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

const removeMemberFromChannelSchema = z.object({
  userId: z.string().min(1, "UserId is required")
});

export const removeMemberFromChannel = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const channelId = req.params.channelId;
    const payload = removeMemberFromChannelSchema.parse(req.body);
    const targetUserId = payload.userId;

    const channel = await prisma.channel.findFirst({
      where: { id: channelId, deletedAt: null },
      include: { workspace: true }
    });

    if (!channel) {
      return res.status(404).json({ message: "Channel not found" });
    }

    const targetChannelMember = await prisma.channelMember.findFirst({
      where: { channelId, userId: targetUserId, isActive: true }
    });
    if (!targetChannelMember) {
      return res.status(404).json({ message: "User is not a member of this channel" });
    }

    const isRemovingSelf = targetUserId === user.id;

    if (isRemovingSelf) {
      if (channel.channelAdminId === user.id) {
        return res.status(400).json({
          message: "You created this channel. Transfer ownership to another member or delete the channel before leaving."
        });
      }
      await prisma.channelMember.updateMany({
        where: { channelId, userId: targetUserId },
        data: { isActive: false }
      });
      return res.status(200).json({ message: "You have left the channel" });
    }

    // Removing someone else: need permission
    if (channel.isBridgeChannel) {
      if (channel.channelAdminId !== user.id) {
        return res.status(403).json({ message: "Only the channel creator can remove members from this bridge channel" });
      }
    } else {
      const requestingMember = await prisma.member.findFirst({
        where: {
          userId: user.id,
          workspaceId: channel.workspaceId,
          isActive: true
        }
      });
      if (!requestingMember) {
        return res.status(403).json({ message: "You are not a member of this workspace" });
      }
      const isWorkspaceAdmin = requestingMember.role === "ADMIN" || requestingMember.role === "MODERATOR";
      const isChannelCreator = channel.channelAdminId === user.id;
      if (!isWorkspaceAdmin && !isChannelCreator) {
        return res.status(403).json({ message: "You don't have permission to remove members from this channel" });
      }
      if (targetUserId === channel.channelAdminId) {
        return res.status(400).json({ message: "Cannot remove the channel creator. Transfer ownership first or delete the channel." });
      }
    }

    await prisma.channelMember.updateMany({
      where: { channelId, userId: targetUserId },
      data: { isActive: false }
    });

    return res.status(200).json({ message: "Member removed from channel successfully" });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(422).json({ message: "Invalid data", errors: formatError(error) });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateChannel = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const channelId = req.params.id;
    const body = req.body;
    const payload = updateChannelSchema.parse(body);

    // Get the channel with workspace info
    const channel = await prisma.channel.findFirst({
      where: {
        id: channelId,
        deletedAt: null
      },
      include: {
        workspace: true
      }
    });

    if (!channel) {
      return res.status(404).json({ message: "Channel not found" });
    }

    // Check if user is a member of the workspace
    const member = await prisma.member.findFirst({
      where: {
        userId: user.id,
        workspaceId: channel.workspaceId,
        isActive: true
      }
    });

    if (!member) {
      return res.status(403).json({ message: "You are not a member of this workspace" });
    }

    // Check if user has permission to update the channel
    // Only workspace admin, moderator, or channel creator can update
    const isWorkspaceAdmin = member.role === "ADMIN" || member.role === "MODERATOR";
    const isChannelCreator = channel.channelAdminId === user.id;

    if (!isWorkspaceAdmin && !isChannelCreator) {
      return res.status(403).json({ message: "You don't have permission to update this channel" });
    }

    // Update the channel
    const updatedChannel = await prisma.channel.update({
      where: {
        id: channelId
      },
      data: {
        name: payload.name,
        type: payload.type,
        image: payload.image,
        description: payload.description !== undefined ? normalizeOptionalText(payload.description) : undefined,
        updatedAt: new Date()
      }
    });

    publishChannelEvent('channel.updated', updatedChannel).catch((err) =>
      console.error('[Streams] Failed to publish channel.updated event:', err)
    );

    return res.status(200).json({
      message: "Channel updated successfully",
      data: updatedChannel
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const softDeleteChannel = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const channelId = req.params.id;

    // Get the channel with workspace info
    const channel = await prisma.channel.findFirst({
      where: {
        id: channelId,
        deletedAt: null
      },
      include: {
        workspace: true
      }
    });

    if (!channel) {
      return res.status(404).json({ message: "Channel not found" });
    }

    // Check if user is a member of the workspace
    const member = await prisma.member.findFirst({
      where: {
        userId: user.id,
        workspaceId: channel.workspaceId,
        isActive: true
      }
    });

    if (!member) {
      return res.status(403).json({ message: "You are not a member of this workspace" });
    }

    // Check if user has permission to delete the channel
    // Only workspace admin, moderator, or channel creator can delete
    const isWorkspaceAdmin = member.role === "ADMIN" || member.role === "MODERATOR";
    const isChannelCreator = channel.channelAdminId === user.id;

    if (!isWorkspaceAdmin && !isChannelCreator) {
      return res.status(403).json({ message: "You don't have permission to delete this channel" });
    }

    // Soft delete the channel by setting deletedAt timestamp
    const deletedChannel = await prisma.channel.update({
      where: {
        id: channelId
      },
      data: {
        deletedAt: new Date()
      }
    });

    publishChannelEvent('channel.deleted', deletedChannel).catch((err) =>
      console.error('[Streams] Failed to publish channel.deleted event:', err)
    );

    return res.status(200).json({
      message: "Channel soft deleted successfully. All messages and reactions are preserved."
    });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const hardDeleteChannel = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const channelId = req.params.id;
    const deletePass = req.body.DELETE_PASS;

    // Check if DELETE_PASS is provided and matches environment variable
    if (!deletePass || deletePass !== process.env.DELETE_PASS) {
      return res.status(403).json({ message: "Invalid delete password" });
    }

    // Get the channel with workspace info
    const channel = await prisma.channel.findFirst({
      where: {
        id: channelId,
        deletedAt: null
      },
      include: {
        workspace: true
      }
    });

    if (!channel) {
      return res.status(404).json({ message: "Channel not found" });
    }

    // Hard delete everything related to the channel
    // Delete in order to avoid foreign key constraints
    
    // 1. Delete all reactions in messages from this channel
    await prisma.reaction.deleteMany({
      where: {
        message: {
          channelId: channelId
        }
      }
    });

    // 2. Delete all attachments in messages from this channel
    await prisma.attachment.deleteMany({
      where: {
        message: {
          channelId: channelId
        }
      }
    });

    // 3. Delete all forwarded messages from this channel
    await prisma.forwardedMessage.deleteMany({
      where: {
        channelId: channelId
      }
    });

    // 4. Delete all messages in this channel
    await prisma.message.deleteMany({
      where: {
        channelId: channelId
      }
    });

    // 5. Delete all channel members
    await prisma.channelMember.deleteMany({
      where: {
        channelId: channelId
      }
    });

    // Finally delete the channel itself
    await prisma.channel.delete({
      where: {
        id: channelId
      }
    });

    return res.status(200).json({
      message: "Channel and all associated data permanently deleted successfully"
    });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

const createBridgeChannelSchema = z.object({
  name: z.string().min(1),
  workspaceId: z.string(),
  image: z.string().optional()
});

const inviteToBridgeSchema = z.object({
  inviteeEmail: z.string().email()
});

/** Check if an email is registered in Jibbr (for frontend to block invite UI). Auth-protected. */
export const checkInviteEmailRegistered = async (req: Request, res: Response) => {
  try {
    const email = typeof req.query?.email === "string" ? req.query.email.trim().toLowerCase() : "";
    if (!email) {
      return res.status(400).json({ registered: false, message: "Email is required" });
    }
    const authServiceUrl = process.env.AUTH_SERVICE_URL || process.env.AUTH_API_URL;
    if (!authServiceUrl) {
      return res.status(200).json({ registered: false });
    }
    const base = authServiceUrl.replace(/\/$/, "");
    const checkUrl = `${base}/api/internal/check-email-registered`;
    const checkRes = await fetch(checkUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    if (!checkRes.ok) {
      return res.status(200).json({ registered: false });
    }
    const data = (await checkRes.json()) as { registered?: boolean };
    return res.status(200).json({ registered: data.registered === true });
  } catch {
    return res.status(200).json({ registered: false });
  }
};

const acceptInviteSchema = z.object({
  token: z.string().min(1)
});

export const createBridgeChannel = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const payload = createBridgeChannelSchema.parse(req.body);

    const workspace = await prisma.workspace.findFirst({
      where: { id: payload.workspaceId, isActive: true, deletedAt: null }
    });
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    const member = await prisma.member.findFirst({
      where: { userId: user.id, workspaceId: payload.workspaceId, isActive: true }
    });
    const isAdmin = workspace.userId === user.id || member?.role === "ADMIN" || member?.role === "MODERATOR";
    if (!isAdmin) {
      return res.status(403).json({ message: "Only workspace admins can create bridge channels" });
    }

    const channel = await prisma.channel.create({
      data: {
        name: payload.name,
        type: "PUBLIC",
        isBridgeChannel: true,
        workspaceId: payload.workspaceId,
        image: payload.image,
        channelAdminId: user.id,
        members: {
          create: { userId: user.id, isExternal: false }
        }
      }
    });

    publishChannelEvent('channel.created', channel).catch((err) =>
      console.error('[Streams] Failed to publish channel.created event:', err)
    );

    return res.status(201).json({ message: "Bridge channel created successfully", data: channel });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(422).json({ message: "Invalid data", errors: formatError(error) });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const inviteToBridgeChannel = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const channelId = req.params.channelId;
    const payload = inviteToBridgeSchema.parse(req.body);

    const channel = await prisma.channel.findFirst({
      where: { id: channelId, deletedAt: null, isBridgeChannel: true }
    });
    if (!channel) {
      return res.status(404).json({ message: "Bridge channel not found" });
    }
    if (channel.channelAdminId !== user.id) {
      return res.status(403).json({ message: "Only the channel creator can invite external users" });
    }

    const inviteeEmail = payload.inviteeEmail.toLowerCase();

    const authServiceUrl = process.env.AUTH_SERVICE_URL || process.env.AUTH_API_URL;
    if (authServiceUrl) {
      try {
        const base = authServiceUrl.replace(/\/$/, "");
        const checkUrl = `${base}/api/internal/check-email-registered`;
        const checkRes = await fetch(checkUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: inviteeEmail })
        });
        if (!checkRes.ok) {
          console.error("[BridgeInvite] Auth service check failed:", checkRes.status, await checkRes.text());
          return res.status(502).json({
            message: "Unable to verify the invitee. Please try again later."
          });
        }
        const data = (await checkRes.json()) as { registered?: boolean };
        if (data.registered !== true) {
          return res.status(400).json({
            message: "This email is not registered with Jibbr. They need to create an account before you can invite them."
          });
        }
      } catch (err) {
        console.error("[BridgeInvite] Failed to check if email is registered:", err);
        return res.status(502).json({
          message: "Unable to verify the invitee. Please try again later."
        });
      }
    } else {
      const inviteeUser = await prisma.user.findUnique({
        where: { email: inviteeEmail }
      });
      if (!inviteeUser) {
        return res.status(400).json({
          message: "This email is not registered with Jibbr. They need to create an account before you can invite them."
        });
      }
    }

    const isAlreadyMember = await prisma.channelMember.findFirst({
      where: {
        channelId,
        isActive: true,
        user: { email: inviteeEmail }
      }
    });
    if (isAlreadyMember) {
      return res.status(400).json({ message: "User is already a member of this channel" });
    }

    const token = randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 3);

    await prisma.channelInvite.create({
      data: {
        channelId,
        inviteeEmail,
        inviterId: user.id,
        token,
        expiresAt,
        status: "PENDING"
      }
    });

    const clientAppUrl = process.env.CLIENT_APP_URL || "https://jibbr.com";
    const acceptUrl = `${clientAppUrl}/bridge-invite?token=${token}`;

    const inviter = await prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true }
    });
    const inviterName = inviter?.name || "Someone";

    if (authServiceUrl) {
      try {
        const base = authServiceUrl.replace(/\/$/, "");
        const internalUrl = `${base}/api/internal/send-bridge-invite`;
        const emailRes = await fetch(internalUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: inviteeEmail,
            channelName: channel.name,
            inviterName,
            url: acceptUrl
          })
        });
        if (!emailRes.ok) {
          console.error("[BridgeInvite] Auth service email failed:", await emailRes.text());
        }
      } catch (err) {
        console.error("[BridgeInvite] Failed to send invite email:", err);
      }
    } else {
      console.log(`[BridgeInvite] AUTH_SERVICE_URL not set. Would send to ${inviteeEmail}: ${acceptUrl}`);
    }

    return res.status(201).json({
      message: "Invite sent successfully",
      data: { expiresAt: expiresAt.toISOString() }
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(422).json({ message: "Invalid data", errors: formatError(error) });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const acceptBridgeInvite = async (req: Request, res: Response) => {
  try {
    const payload = acceptInviteSchema.parse(req.body);

    const invite = await prisma.channelInvite.findFirst({
      where: {
        token: payload.token,
        status: "PENDING",
        expiresAt: { gt: new Date() }
      },
      include: { channel: true }
    });

    if (!invite) {
      return res.status(400).json({
        message: "Invalid or expired invite. The link may have expired or already been used."
      });
    }

    const inviteeUser = await prisma.user.findUnique({
      where: { email: invite.inviteeEmail }
    });

    if (!inviteeUser) {
      return res.status(400).json({
        message: "Create an account first",
        signupUrl: `${process.env.CLIENT_APP_URL || "https://jibbr.com"}/signup`
      });
    }

    const existing = await prisma.channelMember.findFirst({
      where: { channelId: invite.channelId, userId: inviteeUser.id, isActive: true }
    });
    if (existing) {
      await prisma.channelInvite.update({
        where: { id: invite.id },
        data: { status: "ACCEPTED", acceptedAt: new Date() }
      });
      return res.status(200).json({
        success: true,
        channelId: invite.channelId,
        workspaceId: invite.channel.workspaceId,
        message: "You are already a member"
      });
    }

    await prisma.channelMember.create({
      data: {
        channelId: invite.channelId,
        userId: inviteeUser.id,
        isExternal: true
      }
    });

    await prisma.channelInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() }
    });

    return res.status(200).json({
      success: true,
      channelId: invite.channelId,
      workspaceId: invite.channel.workspaceId,
      message: "Joined bridge channel successfully"
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(422).json({ message: "Invalid data", errors: formatError(error) });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getBridgeChannels = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const channels = await prisma.channel.findMany({
      where: {
        isBridgeChannel: true,
        deletedAt: null,
        members: {
          some: { userId: user.id, isActive: true }
        }
      },
      include: {
        workspace: { select: { id: true, name: true } }
      }
    });

    return res.status(200).json({ message: "Bridge channels fetched successfully", data: channels });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
}; 