import { Request, Response } from "express";
import prisma from "../config/database.js";
import { ZodError } from "zod";
import { z } from "zod";

const STARBOARD_MAX_ITEMS = 200;

type StarboardClientType = "channel" | "member";
type StarboardDbType = "CHANNEL" | "MEMBER";

const toDbType = (type: StarboardClientType): StarboardDbType =>
  type === "channel" ? "CHANNEL" : "MEMBER";

const toClientType = (type: StarboardDbType): StarboardClientType =>
  type === "CHANNEL" ? "channel" : "member";

const starboardItemSchema = z.object({
  type: z.enum(["channel", "member"]),
  id: z.string().min(1).max(128),
});

const replaceStarboardSchema = z.object({
  workspaceId: z.string().min(1),
  items: z.array(starboardItemSchema).max(STARBOARD_MAX_ITEMS),
});

const isActiveWorkspaceMember = async (userId: string, workspaceId: string): Promise<boolean> => {
  const member = await prisma.member.findFirst({
    where: {
      userId,
      workspaceId,
      isActive: true,
    },
    select: { id: true },
  });
  return Boolean(member);
};

/**
 * GET /api/starboard?workspaceId=<id>
 * Returns the current user's ordered Starboard for the workspace.
 * Channel items use Channel.id; member items use the other user's User.id.
 */
export const getStarboard = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const workspaceId = req.query.workspaceId as string | undefined;
    if (!workspaceId) {
      return res.status(400).json({ message: "workspaceId is required" });
    }

    if (!(await isActiveWorkspaceMember(user.id, workspaceId))) {
      return res.status(403).json({ message: "You are not a member of this workspace" });
    }

    const rows = await prisma.starboardItem.findMany({
      where: { userId: user.id, workspaceId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { itemType: true, itemId: true },
    });

    return res.status(200).json({
      message: "Starboard fetched successfully",
      data: {
        items: rows.map((r) => ({ type: toClientType(r.itemType), id: r.itemId })),
      },
    });
  } catch (error) {
    console.error("Error in getStarboard:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * PUT /api/starboard
 * Body: { workspaceId: string, items: [{ type: 'channel' | 'member', id: string }] }
 * Replaces the user's whole ordered Starboard for the workspace (last write wins).
 * Duplicate items are collapsed, keeping the first occurrence.
 */
export const replaceStarboard = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const { workspaceId, items } = replaceStarboardSchema.parse(req.body);

    if (!(await isActiveWorkspaceMember(user.id, workspaceId))) {
      return res.status(403).json({ message: "You are not a member of this workspace" });
    }

    const seen = new Set<string>();
    const deduped = items.filter((item) => {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    await prisma.$transaction([
      prisma.starboardItem.deleteMany({ where: { userId: user.id, workspaceId } }),
      prisma.starboardItem.createMany({
        data: deduped.map((item, index) => ({
          userId: user.id,
          workspaceId,
          itemType: toDbType(item.type),
          itemId: item.id,
          position: index,
        })),
      }),
    ]);

    return res.status(200).json({
      message: "Starboard updated successfully",
      data: { items: deduped },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        message: "Invalid request",
        errors: error.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
      });
    }
    console.error("Error in replaceStarboard:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
