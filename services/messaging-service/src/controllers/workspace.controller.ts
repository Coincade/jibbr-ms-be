import { formatError } from "../helper.js";

import { Request, Response } from "express";
import prisma from "../config/database.js";
import generateCode from "../helpers/generateCode.js";
import { getEmailDomain } from "../helpers/domainUtils.js";
import { createWorkspaceSchema, joinWorkspaceSchema, joinWorkspaceByCodeSchema } from "../validation/workspace.validations.js";
import { ZodError } from "zod";
import { publishWorkspaceEvent } from "../services/streams-publisher.service.js";
import { canAccessWorkspaceResource } from "../helpers/collaborationAccess.js";

const toWorkspaceSlug = (name: string): string => {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "workspace";
};

const buildUniqueWorkspaceSlug = async (workspaceName: string): Promise<string> => {
  const baseSlug = toWorkspaceSlug(workspaceName);

  const directMatch = await prisma.workspace.findFirst({
    where: { slug: baseSlug },
    select: { id: true },
  });
  if (!directMatch) return baseSlug;

  let suffix = 2;
  while (suffix <= 1000) {
    const candidate = `${baseSlug}-${suffix}`;
    const taken = await prisma.workspace.findFirst({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
    suffix += 1;
  }

  return `${baseSlug}-${Date.now().toString(36)}`;
};


export const createWorkspace = async (req: Request, res: Response) => {
  try {
    const joinCode = generateCode();
    const user = req.user;

    const body = req.body;
    const payload = createWorkspaceSchema.parse(body);

    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    // Domain check: only one workspace per domain
    const userDomain = getEmailDomain(user.email);
    if (userDomain) {
      const existingForDomain = await prisma.workspace.findFirst({
        where: {
          isActive: true,
          deletedAt: null,
          user: {
            email: {
              endsWith: `@${userDomain}`,
              mode: "insensitive",
            },
          },
        },
      });
      if (existingForDomain) {
        return res.status(400).json({
          message: "A workspace already exists for your organization. Please join using the join code.",
        });
      }
    }

    const workspaceSlug = await buildUniqueWorkspaceSlug(payload.name);
    const workspace = await prisma.workspace.create({
      data: {
        name: payload.name,
        slug: workspaceSlug,
        joinCode: joinCode,
        userId: user.id,
      },
    });

    publishWorkspaceEvent('workspace.created', workspace).catch((err) =>
      console.error('[Streams] Failed to publish workspace.created event:', err)
    );

    await prisma.member.create({
      data: {
        userId: user.id,
        workspaceId: workspace.id,
        role: "ADMIN",
      },
    });

    // Create General channel (PUBLIC)
    const generalChannel = await prisma.channel.create({
      data: {
        name: "General",
        workspaceId: workspace.id,
        type: "PUBLIC",
        channelAdminId: user.id,
      },
    });

    // Create TownHall channel (ANNOUNCEMENT)
    const townHallChannel = await prisma.channel.create({
      data: {
        name: "TownHall",
        workspaceId: workspace.id,
        type: "ANNOUNCEMENT",
        channelAdminId: user.id,
      },
    });

    // Add workspace creator to both channels
    await prisma.channelMember.createMany({
      data: [
        {
          userId: user.id,
          channelId: generalChannel.id,
        },
        {
          userId: user.id,
          channelId: townHallChannel.id,
        },
      ],
    });

    return res.status(201).json({
      message: "Workspace created successfully",
      data: {
        workspaceId: workspace.id,
        joinCode: joinCode,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const getAllWorkspaces = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }
    const workspaces = await prisma.workspace.findMany({
      where: {
        isActive: true,
        deletedAt: null,
      },
    });
    return res.status(200).json({
      message: "Workspaces fetched successfully",
      data: workspaces,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const getWorkspace = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: req.params.id,
        isActive: true,
        deletedAt: null,
      },
    });
    return res.status(200).json({
      message: "Workspace fetched successfully",
      data: workspace,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getAllWorkspacesForUser = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const userDomain = getEmailDomain(user.email);

    const ownedOrMemberWorkspaces = await prisma.workspace.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        OR: [
          { userId: user.id },
          {
            members: {
              some: {
                userId: user.id,
                isActive: true,
              },
            },
          },
        ],
      },
      include: {
        user: { select: { email: true } },
        members: { where: { userId: user.id }, select: { userId: true } },
      },
    });

    let domainWorkspaceForJoin: (typeof ownedOrMemberWorkspaces)[number] | null = null;
    if (userDomain) {
      const wsForDomain = await prisma.workspace.findFirst({
        where: {
          isActive: true,
          deletedAt: null,
          user: {
            email: {
              endsWith: `@${userDomain}`,
              mode: "insensitive",
            },
          },
        },
        include: {
          user: { select: { email: true } },
          members: { where: { userId: user.id }, select: { userId: true } },
        },
      });
      if (wsForDomain && wsForDomain.members.length === 0) {
        domainWorkspaceForJoin = wsForDomain;
      }
    }

    // canCreate: true if no workspace exists for the domain yet (first user), OR if the current user
    // owns a workspace in the domain (first user who created — they can create more workspaces).
    const workspaceExistsInDomain = userDomain
      ? await prisma.workspace.findFirst({
          where: {
            isActive: true,
            deletedAt: null,
            user: {
              email: {
                endsWith: `@${userDomain}`,
                mode: "insensitive",
              },
            },
          },
        })
      : null;
    const userOwnsWorkspaceInDomain =
      userDomain &&
      ownedOrMemberWorkspaces.some(
        (ws) => ws.userId === user.id && getEmailDomain(ws.user?.email ?? "") === userDomain
      );
    const canCreate = userDomain
      ? !workspaceExistsInDomain || !!userOwnsWorkspaceInDomain
      : false;

    const workspacesMap = new Map(
      ownedOrMemberWorkspaces.map((ws) => [
        ws.id,
        {
          ...ws,
          canEnter: true,
          canJoin: false,
          joinCode: ws.joinCode,
        },
      ])
    );

    if (domainWorkspaceForJoin && !workspacesMap.has(domainWorkspaceForJoin.id)) {
      const { joinCode: _jc, ...rest } = domainWorkspaceForJoin;
      workspacesMap.set(domainWorkspaceForJoin.id, {
        ...rest,
        canEnter: false,
        canJoin: true,
      } as (typeof ownedOrMemberWorkspaces)[number] & { canEnter: boolean; canJoin: boolean });
    }

    const workspaces = Array.from(workspacesMap.values()).map(
      ({ members, user: owner, joinCode, canEnter, canJoin, ...ws }) => ({
        ...ws,
        canEnter,
        canJoin,
        ...(canEnter && joinCode ? { joinCode } : {}),
      })
    );

    return res.status(200).json({
      message: "Workspaces fetched successfully",
      data: { workspaces, canCreate },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getWorkspaceMembers = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }
    const workspace = await prisma.workspace.findUnique({
      where: {
        id: req.params.id,
        isActive: true,
      },
    });
    if (!workspace) {
      return res.status(422).json({ message: "Workspace not found" });
    }

    const canAccess = await canAccessWorkspaceResource(user.id, workspace.id, "workspace");
    if (!canAccess) {
      return res.status(403).json({ message: "You don't have access to this workspace" });
    }
    const members = await prisma.member.findMany({
      where: {
        workspaceId: workspace.id,
        isActive: true
      },
      include: {
        user: {
          select: {
            name: true,
            image: true,
            email: true
          }
        }
      }
    });
    return res.status(200).json({ message: "Members fetched successfully", data: members });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const joinWorkspace = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const body = req.body;
    const payload = joinWorkspaceSchema.parse(body);

    const workspace = await prisma.workspace.findUnique({
      where: {
        id: req.params.id,
        isActive: true,
        joinCode: payload.joinCode,
      },
    });
    if (!workspace) {
      return res.status(422).json({ message: "Workspace not found" });
    }

    const existingMember = await prisma.member.findFirst({
      where: {
        userId: user.id,
        workspaceId: workspace.id,
        isActive: true
      },
    });

    if (existingMember) {
      return res.status(422).json({ message: "You are already a member of this workspace" });
    }
    
    const member = await prisma.member.create({
      data: {
        userId: user.id,
        workspaceId: workspace.id,
        role: "MEMBER",
      },
    });

    // Get the default channels (General and TownHall)
    const defaultChannels = await prisma.channel.findMany({
      where: {
        workspaceId: workspace.id,
        name: {
          in: ["General", "TownHall"]
        }
      }
    });

    // Add user to both default channels
    if (defaultChannels.length > 0) {
      await prisma.channelMember.createMany({
        data: defaultChannels.map(channel => ({
          userId: user.id,
          channelId: channel.id,
        })),
        skipDuplicates: true, // Skip if user is already a member
      });
    }

    return res.status(200).json({ message: "Joined workspace successfully", data: member });
  } catch (error) {
    if (error instanceof ZodError) {  
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const joinWorkspaceByCode = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const payload = joinWorkspaceByCodeSchema.parse(req.body);
    const userDomain = getEmailDomain(user.email);
    if (!userDomain) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    const workspace = await prisma.workspace.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        joinCode: payload.joinCode,
        user: {
          email: {
            endsWith: `@${userDomain}`,
            mode: "insensitive",
          },
        },
      },
      include: {
        user: { select: { email: true } },
      },
    });

    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found. Check the join code and ensure you belong to the same organization." });
    }

    const existingMember = await prisma.member.findFirst({
      where: {
        userId: user.id,
        workspaceId: workspace.id,
        isActive: true,
      },
    });

    if (existingMember) {
      return res.status(422).json({ message: "You are already a member of this workspace" });
    }

    await prisma.member.create({
      data: {
        userId: user.id,
        workspaceId: workspace.id,
        role: "MEMBER",
      },
    });

    const defaultChannels = await prisma.channel.findMany({
      where: {
        workspaceId: workspace.id,
        name: { in: ["General", "TownHall"] },
      },
    });

    if (defaultChannels.length > 0) {
      await prisma.channelMember.createMany({
        data: defaultChannels.map((channel) => ({
          userId: user.id,
          channelId: channel.id,
        })),
        skipDuplicates: true,
      });
    }

    return res.status(200).json({
      message: "Joined workspace successfully",
      data: { workspaceId: workspace.id },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const leaveWorkspace = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }
    const workspace = await prisma.workspace.findUnique({
      where: {
        id: req.params.id,
        isActive: true,
      },
    });
    if (!workspace) {
      return res.status(422).json({ message: "Workspace not found" });
    }
    const member = await prisma.member.findFirst({
      where: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    });
    if (!member) {
      return res.status(422).json({ message: "Member not found" });
    }
    await prisma.member.update({
      where: {
        id: member.id,
      },
      data: {
        isActive: false
      }
    });
    return res.status(200).json({ message: "Left workspace successfully" });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateWorkspace = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const workspaceId = req.params.id;
    const { name, fileAttachmentsEnabled, image } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Name is required" });
    }

    const wk = await prisma.workspace.findUnique({
      where: {
        id: workspaceId,
        isActive: true,
      },
    }); 
    if (!wk) {
      return res.status(422).json({ message: "Workspace not found" });
    }

    // Check if user is admin of this workspace
    const member = await prisma.member.findFirst({
      where: {
        userId: user.id,
        workspaceId: workspaceId,
        isActive: true
      }
    });

    const isWorkspaceCreator = wk.userId === user.id;
    const isAdmin = member?.role === "ADMIN";

    if (!isWorkspaceCreator && !isAdmin) {
      return res.status(403).json({ message: "You don't have permission to update this workspace" });
    }

    // Prepare update data
    const updateData: any = { name };
    
    // Only allow fileAttachmentsEnabled to be updated by admins
    if (fileAttachmentsEnabled !== undefined && (isWorkspaceCreator || isAdmin)) {
      updateData.fileAttachmentsEnabled = fileAttachmentsEnabled;
    }
    if (image !== undefined && (isWorkspaceCreator || isAdmin)) {
      updateData.image = image;
    }

    const workspace = await prisma.workspace.update({
      where: {
        id: wk.id,
      },
      data: updateData,
    });

    publishWorkspaceEvent('workspace.updated', workspace).catch((err) =>
      console.error('[Streams] Failed to publish workspace.updated event:', err)
    );

    return res.status(200).json({
      message: "Workspace updated successfully",
      data: workspace,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const softDeleteWorkspace = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const workspaceId = req.params.id;

    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        isActive: true,
        deletedAt: null
      },
    }); 
    if (!workspace) {
      return res.status(422).json({ message: "Workspace not found" });
    }

    // Check if user is the workspace creator or has admin role
    const member = await prisma.member.findFirst({
      where: {
        userId: user.id,
        workspaceId: workspaceId,
        isActive: true
      }
    });

    const isWorkspaceCreator = workspace.userId === user.id;
    const isAdmin = member?.role === "ADMIN";

    if (!isWorkspaceCreator && !isAdmin) {
      return res.status(403).json({ message: "You don't have permission to delete this workspace" });
    }

    // Soft delete the workspace by setting deletedAt timestamp
    const deletedWorkspace = await prisma.workspace.update({
      where: {
        id: workspaceId,
      },
      data: {
        deletedAt: new Date()
      },
    });   

    publishWorkspaceEvent('workspace.deleted', deletedWorkspace).catch((err) =>
      console.error('[Streams] Failed to publish workspace.deleted event:', err)
    );

    return res.status(200).json({ 
      message: "Workspace soft deleted successfully. All data is preserved." 
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const hardDeleteWorkspace = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const workspaceId = req.params.id;
    const deletePass = req.body.DELETE_PASS;

    // Check if DELETE_PASS is provided and matches environment variable
    if (!deletePass || deletePass !== process.env.DELETE_PASS) {
      return res.status(403).json({ message: "Invalid delete password" });
    }

    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        isActive: true,
        deletedAt: null
      },
    }); 
    if (!workspace) {
      return res.status(422).json({ message: "Workspace not found" });
    }

    // Messages in this workspace (channels + DMs). Reused for dependent deletes.
    const messageInWorkspace = {
      OR: [
        { channel: { workspaceId: workspaceId } },
        { conversation: { workspaceId: workspaceId } },
      ],
    };

    // Hard delete everything related to the workspace (order respects FK constraints)

    // 1–2. Reactions & attachments on workspace messages
    await prisma.reaction.deleteMany({
      where: { message: messageInWorkspace },
    });
    await prisma.attachment.deleteMany({
      where: { message: messageInWorkspace },
    });

    // 3. Forwarded rows in this workspace OR pointing at originals in this workspace
    //    (originalMessageId is RESTRICT — forwards can live in other channels/DMs)
    await prisma.forwardedMessage.deleteMany({
      where: {
        OR: [
          { channel: { workspaceId: workspaceId } },
          { conversation: { workspaceId: workspaceId } },
          { originalMessage: messageInWorkspace },
        ],
      },
    });

    // 4. All workspace channel + conversation messages
    await prisma.message.deleteMany({
      where: messageInWorkspace,
    });

    // 5–6. Channels
    await prisma.channelMember.deleteMany({
      where: {
        channel: {
          workspaceId: workspaceId
        }
      }
    });
    await prisma.channel.deleteMany({
      where: {
        workspaceId: workspaceId
      }
    });

    // 7. Workspace DMs
    await prisma.conversationReadStatus.deleteMany({
      where: { conversation: { workspaceId: workspaceId } },
    });
    await prisma.conversationParticipant.deleteMany({
      where: { conversation: { workspaceId: workspaceId } },
    });
    await prisma.conversation.deleteMany({
      where: { workspaceId: workspaceId },
    });

    // 8–9. Members and workspace (UserRecent rows cascade on workspace)
    await prisma.member.deleteMany({
      where: {
        workspaceId: workspaceId
      }
    });
    await prisma.workspace.delete({
      where: {
        id: workspaceId
      }
    });

    return res.status(200).json({ 
      message: "Workspace and all associated data permanently deleted successfully" 
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getPublicChannels = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const workspaceId = req.params.id;

    // Check if workspace exists and is active
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!workspace) {
      return res.status(422).json({ message: "Workspace not found" });
    }

    // Check if user is a member of this workspace
    const member = await prisma.member.findFirst({
      where: {
        userId: user.id,
        workspaceId: workspaceId,
        isActive: true,
      },
    });

    if (!member) {
      return res.status(403).json({ message: "You don't have access to this workspace" });
    }

    // Get all public channels in the workspace (exclude bridge channels)
    const publicChannels = await prisma.channel.findMany({
      where: {
        workspaceId: workspaceId,
        type: "PUBLIC",
        deletedAt: null,
        isBridgeChannel: false,
      },
      select: {
        id: true,
        name: true,
        type: true,
        image: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            members: true,
            messages: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return res.status(200).json({
      message: "Public channels fetched successfully",
      data: publicChannels,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateMemberRole = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const workspaceId = req.params.id;
    const memberId = req.params.memberId;
    const { role } = req.body;

    // Validate role
    if (!role || !["ADMIN", "MODERATOR", "MEMBER"].includes(role)) {
      return res.status(400).json({ 
        message: "Invalid role. Role must be ADMIN, MODERATOR, or MEMBER" 
      });
    }

    // Check if workspace exists and is active
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!workspace) {
      return res.status(422).json({ message: "Workspace not found" });
    }

    // Check if the requesting user is admin of this workspace
    const requestingMember = await prisma.member.findFirst({
      where: {
        userId: user.id,
        workspaceId: workspaceId,
        isActive: true
      }
    });

    const isWorkspaceCreator = workspace.userId === user.id;
    const isAdmin = requestingMember?.role === "ADMIN";

    if (!isWorkspaceCreator && !isAdmin) {
      return res.status(403).json({ 
        message: "Only workspace admins can update member roles" 
      });
    }

    // Check if the target member exists in this workspace
    const targetMember = await prisma.member.findFirst({
      where: {
        id: memberId,
        workspaceId: workspaceId,
        isActive: true
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!targetMember) {
      return res.status(422).json({ 
        message: "Member not found in this workspace" 
      });
    }

    // Prevent workspace creator from changing their own role
    if (targetMember.userId === workspace.userId) {
      return res.status(400).json({ 
        message: "Cannot change the role of the workspace creator" 
      });
    }

    // Prevent users from changing their own role
    if (targetMember.userId === user.id) {
      return res.status(400).json({ 
        message: "Cannot change your own role" 
      });
    }

    // Update the member's role
    const updatedMember = await prisma.member.update({
      where: {
        id: memberId,
      },
      data: {
        role: role as "ADMIN" | "MODERATOR" | "MEMBER",
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    return res.status(200).json({
      message: `Member role updated to ${role} successfully`,
      data: {
        memberId: updatedMember.id,
        userId: updatedMember.userId,
        userName: updatedMember.user.name,
        userEmail: updatedMember.user.email,
        role: updatedMember.role,
        workspaceId: updatedMember.workspaceId
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};