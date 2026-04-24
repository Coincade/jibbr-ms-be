import { filterUserIdsWhoCanReadChannel } from '@jibbr/database';
import prisma from '../config/database.js';
import PushService from './push.service.js';
import { shouldNotify, type NotificationPrefsRaw } from '@jibbr/shared-utils';

export interface NotificationData {
  id: string;
  type:
    | 'NEW_MESSAGE'
    | 'MENTION'
    | 'REACTION'
    | 'CHANNEL_INVITE'
    | 'WORKSPACE_INVITE'
    | 'COLLABORATION_REQUEST'
    | 'COLLABORATION_APPROVED'
    | 'COLLABORATION_REVOKED'
    | 'SYSTEM';
  title: string;
  message: string;
  data?: any;
  userId: string;
  createdAt: Date;
}

export class NotificationService {
  private static async getMutedUserIdsForChannel(channelId: string): Promise<Set<string>> {
    const rows = await prisma.userChannelMute.findMany({
      where: { channelId },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }

  private static sanitizeMessagePreview(messageContent?: string | null) {
    if (!messageContent) {
      return 'Sent an attachment';
    }

    const text = messageContent
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text.length) {
      return 'Sent an attachment';
    }

    return text.length > 120 ? `${text.substring(0, 117)}...` : text;
  }

  static async incrementChannelUnreadCount(
    channelId: string,
    userId: string
  ): Promise<void> {
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

  static async incrementConversationUnreadCount(
    conversationId: string,
    userId: string
  ): Promise<void> {
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

  static async createNotification(
    data: Omit<NotificationData, 'id' | 'createdAt'>
  ): Promise<NotificationData> {
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

      const preview =
        NotificationService.sanitizeMessagePreview(messageContent);

      const mutedUserIds = await NotificationService.getMutedUserIdsForChannel(channelId);

      const allowedRecipients = await filterUserIdsWhoCanReadChannel(
        prisma,
        channelId,
        channelMembers.map((m) => m.userId)
      );

      for (const member of channelMembers) {
        if (!allowedRecipients.has(member.userId)) {
          continue;
        }

        await this.incrementChannelUnreadCount(channelId, member.userId);

        if (mutedUserIds.has(member.userId)) continue;

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
        const tokens =
          member.user.pushTokens?.map((tokenRecord) => tokenRecord.token) ??
          [];

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

      const preview =
        NotificationService.sanitizeMessagePreview(messageContent);

      for (const participant of participants) {
        await this.incrementConversationUnreadCount(
          conversationId,
          participant.userId
        );

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
        const tokens =
          participant.user.pushTokens?.map(
            (tokenRecord) => tokenRecord.token
          ) ?? [];

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
}


