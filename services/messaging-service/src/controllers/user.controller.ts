// [mentions] User search controller
import { Request, Response } from "express";
import prisma from "../config/database.js";
import { z } from "zod";

const searchUsersSchema = z.object({
  workspaceId: z.string().optional(),
  channelId: z.string().min(1, "Channel ID is required"),
  q: z.string().min(1, "Search query is required").max(50, "Query too long"),
});

/**
 * Search users who can access a channel (prefix search)
 * GET /api/users/search?workspaceId=&channelId=&q=
 */
export const searchUsers = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const query = req.query;
    const payload = searchUsersSchema.parse({
      workspaceId: query.workspaceId,
      channelId: query.channelId,
      q: query.q,
    });

    // Verify requester can access the channel
    const requesterMember = await prisma.channelMember.findFirst({
      where: {
        channelId: payload.channelId,
        userId: user.id,
        isActive: true,
      },
    });

    if (!requesterMember) {
      return res.status(403).json({ message: "You are not a member of this channel" });
    }

    // Get channel to find workspace
    const channel = await prisma.channel.findUnique({
      where: { id: payload.channelId },
      select: { workspaceId: true },
    });

    if (!channel) {
      return res.status(404).json({ message: "Channel not found" });
    }

    // Find users who are members of this channel
    // Prefix search on name (ILIKE for case-insensitive)
    const channelMembers = await prisma.channelMember.findMany({
      where: {
        channelId: payload.channelId,
        isActive: true,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
      take: 20,
    });

    // Filter by prefix search (case-insensitive)
    const searchLower = payload.q.toLowerCase();
    const matchingUsers = channelMembers
      .map((cm) => cm.user)
      .filter((u) => {
        const name = u.name?.toLowerCase() || "";
        const email = u.email?.toLowerCase() || "";
        return name.startsWith(searchLower) || email.startsWith(searchLower);
      })
      .slice(0, 20);

    return res.status(200).json({
      message: "Users fetched successfully",
      data: matchingUsers.map((u) => ({
        id: u.id,
        username: u.name || u.email.split("@")[0],
        displayName: u.name || u.email,
        avatarUrl: u.image,
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(422).json({
        message: "Invalid data",
        errors: error.errors,
      });
    }
    console.error("[mentions] User search error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

