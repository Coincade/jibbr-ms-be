import prisma from "../config/database.js";
import PushService from "./push.service.js";
import { shouldNotify, type NotificationPrefsRaw } from "@jibbr/shared-utils";

export interface NotificationData {
  id: string;
  type: 'NEW_MESSAGE' | 'MENTION' | 'REACTION' | 'CHANNEL_INVITE' | 'WORKSPACE_INVITE' | 'SYSTEM';
  title: string;
  message: string;
  data?: any;
  userId: string;
  createdAt: Date;
}

export class NotificationService {
  private static sanitizeMessagePreview(messageContent?: string | null) {
    if (!messageContent) {
      return "Sent an attachment";
    }

    const text = messageContent
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text.length) {
      return "Sent an attachment";
    }

    return text.length > 120 ? `${text.substring(0, 117)}...` : text;
  }

  /**
   * Increment unread count for a channel
   */
  static async incrementChannelUnreadCount(channelId: string, userId: string): Promise<void> {
    try {
      await prisma.channelMember.update({
        where: {
          channelId_userId: {
            channelId,
            userId,
          },
        },
        data: {
          unreadCount: {
            increment: 1,
          },
        },
      });
    } catch (error) {
      console.error('Error incrementing channel unread count:', error);
    }
  }

  /**
   * Increment unread count for a conversation
   */
  static async incrementConversationUnreadCount(conversationId: string, userId: string): Promise<void> {
    try {
      await prisma.conversationReadStatus.upsert({
        where: {
          conversationId_userId: {
            conversationId,
            userId,
          },
        },
        update: {
          unreadCount: {
            increment: 1,
          },
        },
        create: {
          conversationId,
          userId,
          unreadCount: 1,
        },
      });
    } catch (error) {
      console.error('Error incrementing conversation unread count:', error);
    }
  }

  /**
   * Create a notification for a user
   */
  static async createNotification(data: Omit<NotificationData, 'id' | 'createdAt'>): Promise<NotificationData> {
    try {
      const notification = await prisma.userNotification.create({
        data: {
          userId: data.userId,
          type: data.type,
          title: data.title,
          message: data.message,
          data: data.data,
        },
      });

      return {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        data: notification.data as any,
        userId: notification.userId,
        createdAt: notification.createdAt,
      };
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Create notification for new message in channel
   */
  static async notifyNewChannelMessage(
    channelId: string,
    messageId: string,
    senderId: string,
    messageContent: string,
    channelName: string
  ): Promise<void> {
    try {
      const channelMembers = await prisma.channelMember.findMany({
        where: {
          channelId,
          userId: { not: senderId },
          isActive: true,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              timezone: true,
              pushTokens: { select: { token: true } },
              notificationPreferences: {
                select: {
                  level: true,
                  muteAll: true,
                  tangentReplies: true,
                  starredMessagesEvenIfPaused: true,
                  newHuddles: true,
                  pushNotifications: true,
                  scheduleEnabled: true,
                  scheduleMode: true,
                  scheduleDays: true,
                  scheduleStart: true,
                  scheduleEnd: true,
                },
              },
            },
          },
        },
      });

      const sender = await prisma.user.findUnique({
        where: { id: senderId },
        select: { name: true },
      });

      const preview = NotificationService.sanitizeMessagePreview(messageContent);

      for (const member of channelMembers) {
        await this.incrementChannelUnreadCount(channelId, member.userId);

        const prefs: NotificationPrefsRaw | null = member.user.notificationPreferences
          ? {
              ...member.user.notificationPreferences,
              timezone: member.user.timezone ?? undefined,
            }
          : null;

        const event = { isChannelMessage: true, isMention: false, isDirectMessage: false };
        if (!shouldNotify(prefs, event)) continue;

        await this.createNotification({
          userId: member.userId,
          type: 'NEW_MESSAGE',
          title: `New message in #${channelName}`,
          message: `${sender?.name || 'Someone'}: ${preview}`,
          data: {
            channelId,
            messageId,
            senderId,
            channelName,
          },
        });

        const pushPreference =
          member.user.notificationPreferences?.pushNotifications ?? true;
        const tokens = member.user.pushTokens?.map((tokenRecord) => tokenRecord.token) ?? [];

        if (pushPreference && tokens.length) {
          await PushService.sendToTokens(tokens, {
            title: `New message in #${channelName}`,
            body: `${sender?.name || 'Someone'}: ${preview}`,
            data: {
              channelId,
              messageId,
              senderId,
              type: 'channel',
            },
          });
        }
      }
    } catch (error) {
      console.error('Error notifying new channel message:', error);
    }
  }

  /**
   * Create notification for new direct message
   */
  static async notifyNewDirectMessage(
    conversationId: string,
    messageId: string,
    senderId: string,
    messageContent: string
  ): Promise<void> {
    try {
      const participants = await prisma.conversationParticipant.findMany({
        where: {
          conversationId,
          userId: { not: senderId },
          isActive: true,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              timezone: true,
              pushTokens: { select: { token: true } },
              notificationPreferences: {
                select: {
                  level: true,
                  muteAll: true,
                  tangentReplies: true,
                  starredMessagesEvenIfPaused: true,
                  newHuddles: true,
                  pushNotifications: true,
                  scheduleEnabled: true,
                  scheduleMode: true,
                  scheduleDays: true,
                  scheduleStart: true,
                  scheduleEnd: true,
                },
              },
            },
          },
        },
      });

      const sender = await prisma.user.findUnique({
        where: { id: senderId },
        select: { name: true },
      });

      const preview = NotificationService.sanitizeMessagePreview(messageContent);

      for (const participant of participants) {
        await this.incrementConversationUnreadCount(conversationId, participant.userId);

        const prefs: NotificationPrefsRaw | null = participant.user.notificationPreferences
          ? {
              ...participant.user.notificationPreferences,
              timezone: participant.user.timezone ?? undefined,
            }
          : null;

        const event = { isDirectMessage: true, isMention: false, isChannelMessage: false };
        if (!shouldNotify(prefs, event)) continue;

        await this.createNotification({
          userId: participant.userId,
          type: 'NEW_MESSAGE',
          title: `New message from ${sender?.name || 'Someone'}`,
          message: preview,
          data: {
            conversationId,
            messageId,
            senderId,
            senderName: sender?.name,
          },
        });

        const pushPreference =
          participant.user.notificationPreferences?.pushNotifications ?? true;
        const tokens = participant.user.pushTokens?.map((tokenRecord) => tokenRecord.token) ?? [];

        if (pushPreference && tokens.length) {
          await PushService.sendToTokens(tokens, {
            title: `New message from ${sender?.name || 'Someone'}`,
            body: preview,
            data: {
              conversationId,
              messageId,
              senderId,
              type: 'direct',
            },
          });
        }
      }
    } catch (error) {
      console.error('Error notifying new direct message:', error);
    }
  }

  /**
   * Create notification for mention
   */
  static async notifyMention(
    channelId: string,
    messageId: string,
    mentionedUserId: string,
    senderId: string,
    messageContent: string,
    channelName: string
  ): Promise<void> {
    try {
      const sender = await prisma.user.findUnique({
        where: { id: senderId },
        select: { name: true },
      });

      const preview = NotificationService.sanitizeMessagePreview(messageContent);

      const targetUser = await prisma.user.findUnique({
        where: { id: mentionedUserId },
        select: {
          timezone: true,
          pushTokens: { select: { token: true } },
          notificationPreferences: {
            select: {
              level: true,
              muteAll: true,
              tangentReplies: true,
              starredMessagesEvenIfPaused: true,
              newHuddles: true,
              pushNotifications: true,
              mentionNotifications: true,
              scheduleEnabled: true,
              scheduleMode: true,
              scheduleDays: true,
              scheduleStart: true,
              scheduleEnd: true,
            },
          },
        },
      });

      const prefs: NotificationPrefsRaw | null = targetUser?.notificationPreferences
        ? {
            ...targetUser.notificationPreferences,
            timezone: targetUser.timezone ?? undefined,
          }
        : null;

      const event = { isMention: true, isDirectMessage: false, isChannelMessage: false };
      if (!shouldNotify(prefs, event)) return;

      await this.createNotification({
        userId: mentionedUserId,
        type: 'MENTION',
        title: `You were mentioned in #${channelName}`,
        message: `${sender?.name || 'Someone'} mentioned you: ${preview}`,
        data: {
          channelId,
          messageId,
          senderId,
          channelName,
        },
      });

      const pushPreference =
        targetUser?.notificationPreferences?.pushNotifications ?? true;
      const mentionPreference =
        targetUser?.notificationPreferences?.mentionNotifications ?? true;
      const tokens = targetUser?.pushTokens?.map((record) => record.token) ?? [];

      if (pushPreference && mentionPreference && tokens.length) {
        await PushService.sendToTokens(tokens, {
          title: `Mentioned in #${channelName}`,
          body: `${sender?.name || 'Someone'}: ${preview}`,
          data: {
            channelId,
            messageId,
            senderId,
            type: 'mention',
          },
        });
      }
    } catch (error) {
      console.error('Error notifying mention:', error);
    }
  }

  /**
   * Create notification for reaction
   */
  static async notifyReaction(
    messageId: string,
    reactorId: string,
    messageOwnerId: string,
    emoji: string,
    channelName?: string,
    conversationId?: string
  ): Promise<void> {
    try {
      if (reactorId === messageOwnerId) return;

      const reactor = await prisma.user.findUnique({
        where: { id: reactorId },
        select: { name: true },
      });

      const targetUser = await prisma.user.findUnique({
        where: { id: messageOwnerId },
        select: {
          timezone: true,
          pushTokens: { select: { token: true } },
          notificationPreferences: {
            select: {
              level: true,
              muteAll: true,
              tangentReplies: true,
              starredMessagesEvenIfPaused: true,
              newHuddles: true,
              pushNotifications: true,
              scheduleEnabled: true,
              scheduleMode: true,
              scheduleDays: true,
              scheduleStart: true,
              scheduleEnd: true,
            },
          },
        },
      });

      const prefs: NotificationPrefsRaw | null = targetUser?.notificationPreferences
        ? {
            ...targetUser.notificationPreferences,
            timezone: targetUser.timezone ?? undefined,
          }
        : null;

      const event = { isReaction: true, isMention: false, isDirectMessage: false, isChannelMessage: false };
      if (!shouldNotify(prefs, event)) return;

      const title = channelName
        ? `Reaction in #${channelName}`
        : 'New reaction to your message';

      const notification = await this.createNotification({
        userId: messageOwnerId,
        type: 'REACTION',
        title,
        message: `${reactor?.name || 'Someone'} reacted with ${emoji} to your message`,
        data: {
          messageId,
          reactorId,
          emoji,
          channelName,
          conversationId,
        },
      });

      const pushPreference =
        targetUser?.notificationPreferences?.pushNotifications ?? true;
      const tokens = targetUser?.pushTokens?.map((record) => record.token) ?? [];

      if (pushPreference && tokens.length) {
        await PushService.sendToTokens(tokens, {
          title,
          body: `${reactor?.name || 'Someone'} reacted with ${emoji}`,
          data: {
            messageId,
            reactionId: notification.id,
            channelName,
            conversationId,
            type: 'reaction',
          },
        });
      }
    } catch (error) {
      console.error('Error notifying reaction:', error);
    }
  }

  /**
   * Get unread counts for a user
   */
  static async getUserUnreadCounts(userId: string, workspaceId?: string) {
    try {
      // Get channel unread counts
      const channelUnreadCounts = await prisma.channelMember.findMany({
        where: {
          userId,
          isActive: true,
          channel: {
            workspace: workspaceId ? {
              id: workspaceId
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
          userId,
          conversation: {
            participants: {
              some: {
                userId,
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
                  userId: { not: userId },
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

      return {
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
      };
    } catch (error) {
      console.error('Error getting user unread counts:', error);
      throw error;
    }
  }

  /**
   * Mark messages as read for a channel
   */
  static async markChannelAsRead(channelId: string, userId: string): Promise<void> {
    try {
      await prisma.channelMember.update({
        where: {
          channelId_userId: {
            channelId,
            userId,
          },
        },
        data: {
          lastReadAt: new Date(),
          unreadCount: 0,
        },
      });
    } catch (error) {
      console.error('Error marking channel as read:', error);
      throw error;
    }
  }

  /**
   * Mark messages as read for a conversation
   */
  static async markConversationAsRead(conversationId: string, userId: string): Promise<void> {
    try {
      await prisma.conversationReadStatus.upsert({
        where: {
          conversationId_userId: {
            conversationId,
            userId,
          },
        },
        update: {
          lastReadAt: new Date(),
          unreadCount: 0,
        },
        create: {
          conversationId,
          userId,
          lastReadAt: new Date(),
          unreadCount: 0,
        },
      });
    } catch (error) {
      console.error('Error marking conversation as read:', error);
      throw error;
    }
  }
} 