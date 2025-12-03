import { Request, Response } from "express";
import prisma from "../config/database.js";
import { formatError } from "../helper.js";
import { ZodError } from "zod";
import { z } from "zod";

const createChannelSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["PUBLIC", "PRIVATE"]),
  workspaceId: z.string(),
  image: z.string().optional()
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
  image: z.string().optional()
});

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

    // Get channels where user is a member (excluding soft-deleted channels)
    const channels = await prisma.channel.findMany({
      where: {
        workspaceId: workspaceId,
        deletedAt: null,
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

    const channel = await prisma.channel.findFirst({
      where: {
        id: channelId,
        deletedAt: null
      },
      include: {
        workspace: true,
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
          }
        }
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

    // Check if user is a member of the channel
    const userChannelMembership = channel.members.find(member => member.userId === user.id);
    if (!userChannelMembership) {
      return res.status(403).json({ message: "You are not a member of this channel" });
    }

    return res.status(200).json({
      message: "Channel fetched successfully",
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

    // Check if user is already a member of the channel
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

    // Create channel membership
    const channelMember = await prisma.channelMember.create({
      data: {
        userId: user.id,
        channelId: channel.id
      }
    });

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

    // Check if the channel is private
    if (channel.type !== "PRIVATE") {
      return res.status(400).json({ message: "Can only add members to private channels" });
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

    // Check if the target user is already a member of the channel
    const existingChannelMember = await prisma.channelMember.findFirst({
      where: {
        userId: payload.userId,
        channelId: channel.id,
        isActive: true
      }
    });

    if (existingChannelMember) {
      return res.status(400).json({ message: "User is already a member of this channel" });
    }

    // Add the user to the channel
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
        updatedAt: new Date()
      }
    });

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
    await prisma.channel.update({
      where: {
        id: channelId
      },
      data: {
        deletedAt: new Date()
      }
    });

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