import { Request, Response } from "express";
import { formatError } from "../helper.js";
import prisma from "../config/database.js";
import { ZodError } from "zod";
import { z } from "zod";

// Validation schemas
const markAsReadSchema = z.object({
  channelId: z.string().optional(),
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
});

const getUnreadCountsSchema = z.object({
  workspaceId: z.string().optional(),
});

const notificationLevelSchema = z.enum(["everything", "mentions", "nothing"]);
const scheduleModeSchema = z.enum(["weekdays", "every_day", "custom"]);

const scheduleSchema = z.object({
  enabled: z.boolean().optional(),
  mode: scheduleModeSchema.optional(),
  days: z.array(z.number().min(0).max(6)).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
}).optional();

const soundsSchema = z.object({
  message: z.string().optional(),
  starredOnly: z.string().optional(),
  huddle: z.string().optional(),
}).optional();

const updateNotificationPreferencesSchema = z.object({
  emailNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  desktopNotifications: z.boolean().optional(),
  soundEnabled: z.boolean().optional(),
  mentionNotifications: z.boolean().optional(),
  level: notificationLevelSchema.optional(),
  tangentReplies: z.boolean().optional(),
  starredMessagesEvenIfPaused: z.boolean().optional(),
  newHuddles: z.boolean().optional(),
  schedule: scheduleSchema,
  scheduleEnabled: z.boolean().optional(),
  scheduleMode: scheduleModeSchema.optional(),
  scheduleDays: z.array(z.number().min(0).max(6)).optional(),
  scheduleStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  scheduleEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  muteAll: z.boolean().optional(),
  sounds: soundsSchema,
  soundMessage: z.string().optional(),
  soundStarred: z.string().optional(),
  soundHuddle: z.string().optional(),
  muteHuddleSounds: z.boolean().optional(),
});

const registerPushTokenSchema = z.object({
  pushToken: z.string().min(1, "Push token is required"),
  platform: z.enum(["ios", "android"]).optional(),
  deviceName: z.string().optional(),
  appVersion: z.string().optional(),
});

const unregisterPushTokenSchema = z.object({
  pushToken: z.string().min(1, "Push token is required"),
});

const channelMutesQuerySchema = z.object({
  workspaceId: z.string().min(1),
});

const setChannelMuteBodySchema = z.object({
  channelId: z.string().min(1),
  muted: z.boolean(),
});

// Mark messages as read for a channel or conversation
export const markAsRead = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const body = req.body;
    const payload = markAsReadSchema.parse(body);

    if (payload.channelId) {
      // Mark channel messages as read
      const channelMember = await prisma.channelMember.findUnique({
        where: {
          channelId_userId: {
            channelId: payload.channelId,
            userId: user.id,
          },
        },
        include: { channel: { select: { workspaceId: true } } },
      });

      if (!channelMember) {
        return res.status(403).json({ message: "You are not a member of this channel" });
      }

      // Update last read time and reset unread count
      await prisma.channelMember.update({
        where: {
          channelId_userId: {
            channelId: payload.channelId,
            userId: user.id,
          },
        },
        data: {
          lastReadAt: new Date(),
          unreadCount: 0,
        },
      });

      // Touch recents (Option A: last-opened tracking)
      await prisma.userRecent.upsert({
        where: {
          userId_workspaceId_type_targetId: {
            userId: user.id,
            workspaceId: channelMember.channel.workspaceId,
            type: "CHANNEL",
            targetId: payload.channelId,
          },
        },
        create: {
          userId: user.id,
          workspaceId: channelMember.channel.workspaceId,
          type: "CHANNEL",
          targetId: payload.channelId,
          lastOpenedAt: new Date(),
        },
        update: { lastOpenedAt: new Date() },
      });
    } else if (payload.conversationId) {
      // Mark conversation messages as read
      const participant = await prisma.conversationParticipant.findUnique({
        where: {
          conversationId_userId: {
            conversationId: payload.conversationId,
            userId: user.id,
          },
        },
        include: { conversation: { select: { workspaceId: true } } },
      });

      if (!participant) {
        return res.status(403).json({ message: "You are not a participant of this conversation" });
      }

      // Update or create read status
      await prisma.conversationReadStatus.upsert({
        where: {
          conversationId_userId: {
            conversationId: payload.conversationId,
            userId: user.id,
          },
        },
        update: {
          lastReadAt: new Date(),
          unreadCount: 0,
        },
        create: {
          conversationId: payload.conversationId,
          userId: user.id,
          lastReadAt: new Date(),
          unreadCount: 0,
        },
      });

      // Touch recents (Option A: last-opened tracking)
      await prisma.userRecent.upsert({
        where: {
          userId_workspaceId_type_targetId: {
            userId: user.id,
            workspaceId: participant.conversation.workspaceId,
            type: "CONVERSATION",
            targetId: payload.conversationId,
          },
        },
        create: {
          userId: user.id,
          workspaceId: participant.conversation.workspaceId,
          type: "CONVERSATION",
          targetId: payload.conversationId,
          lastOpenedAt: new Date(),
        },
        update: { lastOpenedAt: new Date() },
      });
    }

    return res.status(200).json({ message: "Messages marked as read" });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    console.error("Error in markAsRead:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get unread counts for channels and conversations
export const getUnreadCounts = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const query = req.query;
    const payload = getUnreadCountsSchema.parse(query);

    // Get channel unread counts
    const channelUnreadCounts = await prisma.channelMember.findMany({
      where: {
        userId: user.id,
        isActive: true,
        channel: {
          workspace: payload.workspaceId ? {
            id: payload.workspaceId
          } : undefined,
        },
      },
      select: {
        channelId: true,
        unreadCount: true,
        lastReadAt: true,
        channel: {
          select: {
            name: true,
            workspaceId: true,
          },
        },
      },
    });

    // Get conversation unread counts
    const conversationUnreadCounts = await prisma.conversationReadStatus.findMany({
      where: {
        userId: user.id,
        conversation: {
          participants: {
            some: {
              userId: user.id,
              isActive: true,
            },
          },
        },
      },
      select: {
        conversationId: true,
        unreadCount: true,
        lastReadAt: true,
        conversation: {
          select: {
            participants: {
              where: {
                userId: { not: user.id },
                isActive: true,
              },
              select: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    image: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Calculate total unread count
    const totalUnread = channelUnreadCounts.reduce((sum, item) => sum + item.unreadCount, 0) +
                       conversationUnreadCounts.reduce((sum, item) => sum + item.unreadCount, 0);

    return res.status(200).json({
      message: "Unread counts fetched successfully",
      data: {
        totalUnread,
        channels: channelUnreadCounts.map(item => ({
          channelId: item.channelId,
          channelName: item.channel.name,
          workspaceId: item.channel.workspaceId,
          unreadCount: item.unreadCount,
          lastReadAt: item.lastReadAt,
        })),
        conversations: conversationUnreadCounts.map(item => ({
          conversationId: item.conversationId,
          participant: item.conversation.participants[0]?.user,
          unreadCount: item.unreadCount,
          lastReadAt: item.lastReadAt,
        })),
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    console.error("Error in getUnreadCounts:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get user notifications
export const getUserNotifications = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = {
      userId: user.id,
      ...(unreadOnly === 'true' && { isRead: false }),
    };

    const notifications = await prisma.userNotification.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: Number(limit),
    });

    const total = await prisma.userNotification.count({ where });

    return res.status(200).json({
      message: "Notifications fetched successfully",
      data: {
        notifications,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Error in getUserNotifications:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Mark notification as read
export const markNotificationAsRead = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const { notificationId } = req.params;

    const notification = await prisma.userNotification.findFirst({
      where: {
        id: notificationId,
        userId: user.id,
      },
    });

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    await prisma.userNotification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return res.status(200).json({ message: "Notification marked as read" });
  } catch (error) {
    console.error("Error in markNotificationAsRead:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Mark all notifications as read
export const markAllNotificationsAsRead = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    await prisma.userNotification.updateMany({
      where: {
        userId: user.id,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return res.status(200).json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error in markAllNotificationsAsRead:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

function normalizePreferences(raw: {
  level?: string;
  tangentReplies?: boolean;
  starredMessagesEvenIfPaused?: boolean;
  newHuddles?: boolean;
  desktopNotifications?: boolean;
  soundEnabled?: boolean;
  mentionNotifications?: boolean;
  scheduleEnabled?: boolean;
  scheduleMode?: string;
  scheduleDays?: number[];
  scheduleStart?: string;
  scheduleEnd?: string;
  muteAll?: boolean;
  soundMessage?: string;
  soundStarred?: string;
  soundHuddle?: string;
  muteHuddleSounds?: boolean;
  updatedAt?: Date;
}) {
  const scheduleDays = raw.scheduleDays ?? [1, 2, 3, 4, 5];
  return {
    level: (raw.level ?? "everything") as "everything" | "mentions" | "nothing",
    tangentReplies: raw.tangentReplies ?? true,
    starredMessagesEvenIfPaused: raw.starredMessagesEvenIfPaused ?? false,
    newHuddles: raw.newHuddles ?? true,
    desktopNotifications: raw.desktopNotifications ?? true,
    soundEnabled: raw.soundEnabled ?? true,
    mentionNotifications: raw.mentionNotifications ?? true,
    schedule: {
      enabled: raw.scheduleEnabled ?? false,
      mode: (raw.scheduleMode ?? "weekdays") as "weekdays" | "every_day" | "custom",
      days: scheduleDays,
      startTime: raw.scheduleStart ?? "09:00",
      endTime: raw.scheduleEnd ?? "18:00",
    },
    muteAll: raw.muteAll ?? false,
    sounds: {
      message: raw.soundMessage ?? "boop",
      starredOnly: raw.soundStarred ?? "boop",
      huddle: raw.soundHuddle ?? "boop",
    },
    muteHuddleSounds: raw.muteHuddleSounds ?? false,
    timezone: null as string | null,
    lastUpdatedAt: raw.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

// Get user notification preferences
export const getNotificationPreferences = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    let preferences = await prisma.userNotificationPreference.findUnique({
      where: { userId: user.id },
    });

    if (!preferences) {
      preferences = await prisma.userNotificationPreference.create({
        data: {
          userId: user.id,
        },
      });
    }

    const data = normalizePreferences(preferences);

    return res.status(200).json({
      message: "Notification preferences fetched successfully",
      data,
    });
  } catch (error) {
    console.error("Error in getNotificationPreferences:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

function flattenPayload(payload: z.infer<typeof updateNotificationPreferencesSchema>) {
  const update: Record<string, unknown> = {};
  const flat = [
    "emailNotifications", "pushNotifications", "desktopNotifications",
    "soundEnabled", "mentionNotifications", "level", "tangentReplies",
    "starredMessagesEvenIfPaused", "newHuddles", "scheduleEnabled",
    "scheduleMode", "scheduleDays", "scheduleStart", "scheduleEnd",
    "muteAll", "soundMessage", "soundStarred", "soundHuddle", "muteHuddleSounds",
  ] as const;
  for (const k of flat) {
    const v = payload[k];
    if (v !== undefined) update[k] = v;
  }
  if (payload.schedule) {
    if (payload.schedule.enabled !== undefined) update.scheduleEnabled = payload.schedule.enabled;
    if (payload.schedule.mode !== undefined) update.scheduleMode = payload.schedule.mode;
    if (payload.schedule.days !== undefined) update.scheduleDays = payload.schedule.days;
    if (payload.schedule.startTime !== undefined) update.scheduleStart = payload.schedule.startTime;
    if (payload.schedule.endTime !== undefined) update.scheduleEnd = payload.schedule.endTime;
  }
  if (payload.sounds) {
    if (payload.sounds.message !== undefined) update.soundMessage = payload.sounds.message;
    if (payload.sounds.starredOnly !== undefined) update.soundStarred = payload.sounds.starredOnly;
    if (payload.sounds.huddle !== undefined) update.soundHuddle = payload.sounds.huddle;
  }
  return update;
}

// Update user notification preferences
export const updateNotificationPreferences = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const body = req.body;
    const payload = updateNotificationPreferencesSchema.parse(body);
    const update = flattenPayload(payload);

    const preferences = await prisma.userNotificationPreference.upsert({
      where: { userId: user.id },
      update,
      create: {
        userId: user.id,
        ...update,
      } as Parameters<typeof prisma.userNotificationPreference.create>[0]["data"],
    });

    const data = normalizePreferences(preferences);

    return res.status(200).json({
      message: "Notification preferences updated successfully",
      data,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    console.error("Error in updateNotificationPreferences:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** List channel IDs the current user has muted (for a workspace). Used by desktop + mobile. */
export const getChannelMutes = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const query = channelMutesQuerySchema.parse(req.query);

    const workspaceMember = await prisma.member.findFirst({
      where: {
        workspaceId: query.workspaceId,
        userId: user.id,
        isActive: true,
      },
    });
    if (!workspaceMember) {
      return res.status(403).json({ message: "You are not a member of this workspace" });
    }

    const mutes = await prisma.userChannelMute.findMany({
      where: {
        userId: user.id,
        channel: {
          workspaceId: query.workspaceId,
          deletedAt: null,
        },
      },
      select: { channelId: true },
    });

    return res.status(200).json({
      message: "Channel mutes fetched successfully",
      data: { channelIds: mutes.map((m) => m.channelId) },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    console.error("Error in getChannelMutes:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Mute or unmute a channel for the current user (synced across devices). */
export const setChannelMute = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const body = setChannelMuteBodySchema.parse(req.body);

    const channelMember = await prisma.channelMember.findUnique({
      where: {
        channelId_userId: {
          channelId: body.channelId,
          userId: user.id,
        },
      },
      include: {
        channel: { select: { deletedAt: true } },
      },
    });

    if (!channelMember || !channelMember.isActive) {
      return res.status(403).json({ message: "You are not a member of this channel" });
    }
    if (channelMember.channel.deletedAt) {
      return res.status(404).json({ message: "Channel not found" });
    }

    if (body.muted) {
      await prisma.userChannelMute.upsert({
        where: {
          userId_channelId: {
            userId: user.id,
            channelId: body.channelId,
          },
        },
        create: {
          userId: user.id,
          channelId: body.channelId,
        },
        update: {},
      });
    } else {
      await prisma.userChannelMute.deleteMany({
        where: {
          userId: user.id,
          channelId: body.channelId,
        },
      });
    }

    return res.status(200).json({
      message: body.muted ? "Channel muted successfully" : "Channel unmuted successfully",
      data: { channelId: body.channelId, muted: body.muted },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    console.error("Error in setChannelMute:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Register push notification token for mobile devices
export const registerPushToken = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const payload = registerPushTokenSchema.parse(req.body);

    const platform =
      payload.platform === "ios"
        ? "IOS"
        : payload.platform === "android"
        ? "ANDROID"
        : "UNKNOWN";

    await prisma.userPushToken.upsert({
      where: { token: payload.pushToken },
      update: {
        userId: user.id,
        platform,
        deviceName: payload.deviceName,
        appVersion: payload.appVersion,
        lastUsedAt: new Date(),
      },
      create: {
        token: payload.pushToken,
        userId: user.id,
        platform,
        deviceName: payload.deviceName,
        appVersion: payload.appVersion,
        lastUsedAt: new Date(),
      },
    });

    return res.status(200).json({ message: "Push token registered successfully" });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    console.error("Error in registerPushToken:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Unregister push token (e.g., on logout)
export const unregisterPushToken = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const payload = unregisterPushTokenSchema.parse(req.body);

    await prisma.userPushToken.deleteMany({
      where: {
        token: payload.pushToken,
        userId: user.id,
      },
    });

    return res.status(200).json({ message: "Push token unregistered successfully" });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatError(error);
      return res.status(422).json({ message: "Invalid data", errors });
    }
    console.error("Error in unregisterPushToken:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};