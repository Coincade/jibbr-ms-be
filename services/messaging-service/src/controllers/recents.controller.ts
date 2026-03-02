import { Request, Response } from "express";
import prisma from "../config/database.js";
import { ZodError } from "zod";
import { z } from "zod";

const touchRecentSchema = z.object({
  type: z.enum(["CHANNEL", "CONVERSATION"]),
  targetId: z.string().min(1),
  workspaceId: z.string().min(1),
});

/**
 * GET /api/recents?workspaceId=<id>
 * Returns current user's recents for the workspace (channels + conversations),
 * ordered by lastOpenedAt DESC. Used by frontend to sort Crew Chat, Jibbr, and Bridge Channels.
 */
export const getRecents = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const workspaceId = req.query.workspaceId as string | undefined;
    if (!workspaceId) {
      return res.status(400).json({ message: "workspaceId is required" });
    }

    const member = await prisma.member.findFirst({
      where: {
        userId: user.id,
        workspaceId,
        isActive: true,
      },
    });
    if (!member) {
      return res.status(403).json({ message: "You are not a member of this workspace" });
    }

    const recents = await prisma.userRecent.findMany({
      where: {
        userId: user.id,
        workspaceId,
      },
      orderBy: { lastOpenedAt: "desc" },
    });

    const data = recents.map((r) => ({
      type: r.type,
      targetId: r.targetId,
      lastOpenedAt: r.lastOpenedAt.toISOString(),
    }));

    return res.status(200).json({
      message: "Recents fetched successfully",
      data,
    });
  } catch (error) {
    console.error("Error in getRecents:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * POST /api/recents
 * Body: { type: 'CHANNEL' | 'CONVERSATION', targetId: string, workspaceId: string }
 * Upserts lastOpenedAt = now() for this user/workspace/type/targetId.
 * Call when user opens a channel or DM.
 */
export const touchRecent = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const body = touchRecentSchema.parse(req.body);
    const { type, targetId, workspaceId } = body;

    const member = await prisma.member.findFirst({
      where: {
        userId: user.id,
        workspaceId,
        isActive: true,
      },
    });
    if (!member) {
      return res.status(403).json({ message: "You are not a member of this workspace" });
    }

    if (type === "CHANNEL") {
      const channel = await prisma.channel.findFirst({
        where: {
          id: targetId,
          workspaceId,
          deletedAt: null,
        },
        include: {
          members: {
            where: { userId: user.id, isActive: true },
            take: 1,
          },
        },
      });
      if (!channel || channel.members.length === 0) {
        return res.status(404).json({ message: "Channel not found or you are not a member" });
      }
    } else {
      const conv = await prisma.conversation.findFirst({
        where: {
          id: targetId,
          workspaceId,
        },
        include: {
          participants: {
            where: { userId: user.id, isActive: true },
            take: 1,
          },
        },
      });
      if (!conv || conv.participants.length === 0) {
        return res.status(404).json({ message: "Conversation not found or you are not a participant" });
      }
    }

    await prisma.userRecent.upsert({
      where: {
        userId_workspaceId_type_targetId: {
          userId: user.id,
          workspaceId,
          type,
          targetId,
        },
      },
      create: {
        userId: user.id,
        workspaceId,
        type,
        targetId,
        lastOpenedAt: new Date(),
      },
      update: {
        lastOpenedAt: new Date(),
      },
    });

    return res.status(200).json({
      message: "Recent touched successfully",
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        message: "Invalid request",
        errors: error.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
      });
    }
    console.error("Error in touchRecent:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
