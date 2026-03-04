// [mentions] User search controller + user status
import { Request, Response } from "express";
import prisma from "../config/database.js";
import { z } from "zod";
import { UserPresenceStatus } from "@prisma/client";
import { publishUserStatusChangedEvent } from "../services/streams-publisher.service.js";

const STATUS_TO_DB: Record<string, UserPresenceStatus> = {
  available: "available",
  away: "away",
  "in-a-meeting": "in_a_meeting",
  "do-not-disturb": "do_not_disturb",
  custom: "custom",
};
const STATUS_TO_API: Record<UserPresenceStatus, string> = {
  available: "available",
  away: "away",
  in_a_meeting: "in-a-meeting",
  do_not_disturb: "do-not-disturb",
  custom: "custom",
};

const updateStatusSchema = z.object({
  status: z.enum(["available", "away", "in-a-meeting", "do-not-disturb", "custom"]),
  customMessage: z.string().max(100).optional(),
});

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

/**
 * Update current user's presence status
 * PATCH /api/users/me/status
 */
export const updateMyStatus = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const payload = updateStatusSchema.parse(req.body);
    const dbStatus = STATUS_TO_DB[payload.status];

    await prisma.user.update({
      where: { id: user.id },
      data: {
        presenceStatus: dbStatus,
        customStatusMessage: payload.customMessage ?? null,
      },
    });

    publishUserStatusChangedEvent(user.id, payload.status, payload.customMessage ?? null).catch((err) =>
      console.error("[Streams] Failed to publish user.status_changed:", err)
    );

    return res.status(200).json({
      message: "Status updated successfully",
      data: {
        status: payload.status,
        customMessage: payload.customMessage ?? "",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(422).json({
        message: "Invalid data",
        errors: error.errors,
      });
    }
    console.error("[user status] Update error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Get a user's presence status
 * GET /api/users/:userId/status
 */
export const getUserStatus = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (!requester) {
      return res.status(422).json({ message: "User not found" });
    }

    const { userId } = req.params;

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { presenceStatus: true, customStatusMessage: true, timezone: true },
    });

    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const status = targetUser.presenceStatus ?? "available";
    const apiStatus = STATUS_TO_API[status];

    return res.status(200).json({
      message: "User status fetched successfully",
      data: {
        userId,
        status: apiStatus,
        customMessage: targetUser.customStatusMessage ?? "",
        timezone: targetUser.timezone ?? null,
      },
    });
  } catch (error) {
    console.error("[user status] Get error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Get current user's status
 * GET /api/users/me/status
 */
export const getMyStatus = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { presenceStatus: true, customStatusMessage: true, timezone: true },
    });

    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const status = targetUser.presenceStatus ?? "available";
    const apiStatus = STATUS_TO_API[status];

    return res.status(200).json({
      message: "User status fetched successfully",
      data: {
        userId: user.id,
        status: apiStatus,
        customMessage: targetUser.customStatusMessage ?? "",
        timezone: targetUser.timezone ?? null,
      },
    });
  } catch (error) {
    console.error("[user status] Get my status error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const updateTimezoneSchema = z.object({
  timezone: z.union([z.string().max(64), z.null()]).transform((v) => (v === "" ? null : v)),
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  image: z.union([z.string(), z.null()]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
  phone: z.union([z.string().max(32), z.null()]).optional().transform((v) => (v === "" ? null : v)),
  employeeId: z.union([z.string().max(64), z.null()]).optional().transform((v) => (v === "" ? null : v)),
  designation: z.union([z.string().max(128), z.null()]).optional().transform((v) => (v === "" ? null : v)),
  birthday: z.union([z.string(), z.null()]).optional().transform((v) => {
    if (v === "" || v === null || v === undefined) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }),
});

/**
 * Get current user's full profile
 * GET /api/users/me
 */
export const getMe = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        timezone: true,
        phone: true,
        employeeId: true,
        birthday: true,
        designation: true,
      },
    });

    if (!dbUser) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      message: "Profile fetched successfully",
      data: {
        id: dbUser.id,
        name: dbUser.name ?? undefined,
        email: dbUser.email,
        image: dbUser.image ?? undefined,
        timezone: dbUser.timezone ?? undefined,
        phone: dbUser.phone ?? undefined,
        employeeId: dbUser.employeeId ?? undefined,
        birthday: dbUser.birthday ? dbUser.birthday.toISOString() : undefined,
        designation: dbUser.designation ?? undefined,
      },
    });
  } catch (error) {
    console.error("[user profile] getMe error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Update current user's profile (name, image, phone, employeeId, designation, birthday)
 * PATCH /api/users/me
 */
export const updateMe = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const payload = updateProfileSchema.parse(req.body);
    const data: Record<string, unknown> = {};
    if (payload.name !== undefined) data.name = payload.name;
    if (payload.image !== undefined) data.image = payload.image;
    if (payload.phone !== undefined) data.phone = payload.phone;
    if (payload.employeeId !== undefined) data.employeeId = payload.employeeId;
    if (payload.designation !== undefined) data.designation = payload.designation;
    if (payload.birthday !== undefined) data.birthday = payload.birthday;

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: data as Parameters<typeof prisma.user.update>[0]["data"],
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        timezone: true,
        phone: true,
        employeeId: true,
        birthday: true,
        designation: true,
      },
    });

    return res.status(200).json({
      message: "Profile updated successfully",
      data: {
        id: updated.id,
        name: updated.name ?? undefined,
        email: updated.email,
        image: updated.image ?? undefined,
        timezone: updated.timezone ?? undefined,
        phone: updated.phone ?? undefined,
        employeeId: updated.employeeId ?? undefined,
        birthday: updated.birthday ? updated.birthday.toISOString() : undefined,
        designation: updated.designation ?? undefined,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(422).json({
        message: "Invalid data",
        errors: error.errors,
      });
    }
    console.error("[user profile] updateMe error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Update current user's timezone
 * PATCH /api/users/me/timezone
 */
export const updateMyTimezone = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const payload = updateTimezoneSchema.parse(req.body);

    await prisma.user.update({
      where: { id: user.id },
      data: { timezone: payload.timezone ?? null },
    });

    return res.status(200).json({
      message: "Timezone updated successfully",
      data: {
        userId: user.id,
        timezone: payload.timezone ?? null,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(422).json({
        message: "Invalid data",
        errors: error.errors,
      });
    }
    console.error("[user timezone] Update error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

