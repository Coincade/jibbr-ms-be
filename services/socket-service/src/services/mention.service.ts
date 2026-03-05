// [mentions] Service for processing mentions in messages
import prisma from '../config/database.js';
import { shouldNotify, type NotificationPrefsRaw } from '@jibbr/shared-utils';
import { parseMentions } from '../libs/tiptapMentionParser.js';
import { sanitizeMessageHtml } from '../libs/sanitizeHtml.js';
import { checkSpecialMentionRateLimit } from '../libs/rateLimiter.js';
import { sendToUser } from '../websocket/utils.js';
import { NotificationService } from './notification.service.js';

interface ProcessMentionsResult {
  sanitizedContent: string;
  mentionedUserIds: string[];
}

export async function processMentions(
  content: string,
  authorId: string,
  channelId: string | null,
  jsonContent?: any
): Promise<ProcessMentionsResult> {
  const sanitizedContent = sanitizeMessageHtml(content);

  const mentions = parseMentions(sanitizedContent, jsonContent);

  const mentionedUserIds = mentions.map((m) => m.userId).filter(Boolean);

  const mentionChannelEnabled =
    process.env.MENTION_CHANNEL_ENABLED !== 'false';
  const mentionEveryoneEnabled =
    process.env.MENTION_EVERYONE_ENABLED !== 'false';

  if (channelId && (mentionChannelEnabled || mentionEveryoneEnabled)) {
    const specialMentions = await handleSpecialMentions(
      sanitizedContent,
      authorId,
      channelId,
      mentionedUserIds,
      mentionChannelEnabled,
      mentionEveryoneEnabled
    );
    mentionedUserIds.push(...specialMentions);
  }

  const uniqueMentionedIds = Array.from(new Set(mentionedUserIds)).filter(
    (id) => id !== authorId
  );

  return {
    sanitizedContent,
    mentionedUserIds: uniqueMentionedIds,
  };
}

async function handleSpecialMentions(
  content: string,
  authorId: string,
  channelId: string,
  existingUserIds: string[],
  mentionChannelEnabled: boolean,
  mentionEveryoneEnabled: boolean
): Promise<string[]> {
  const hasChannelMention = /@channel|@here/i.test(content);
  const hasEveryoneMention = /@everyone/i.test(content);

  if (!hasChannelMention && !hasEveryoneMention) {
    return [];
  }

  const userIds: string[] = [];

  if (hasChannelMention && mentionChannelEnabled) {
    const rateLimitKey = `${authorId}:${channelId}`;
    const maxTokens = parseInt(
      process.env.MENTION_CHANNEL_MAX_TOKENS || '1',
      10
    );
    const windowSec = parseInt(
      process.env.MENTION_CHANNEL_RATE_WINDOW_SEC || '120',
      10
    );

    const rateLimit = await checkSpecialMentionRateLimit(
      rateLimitKey,
      maxTokens,
      windowSec
    );
    if (!rateLimit.allowed) {
      console.warn(
        `[mentions] Rate limit exceeded for @channel mention by ${authorId}`
      );
      return [];
    }

    const members = await prisma.channelMember.findMany({
      where: {
        channelId,
        isActive: true,
        userId: { not: authorId },
      },
      select: { userId: true },
    });

    userIds.push(...members.map((m) => m.userId));
  }

  if (hasEveryoneMention && mentionEveryoneEnabled) {
    const members = await prisma.channelMember.findMany({
      where: {
        channelId,
        isActive: true,
        userId: { not: authorId },
      },
      select: { userId: true },
    });

    userIds.push(...members.map((m) => m.userId));
  }

  return userIds;
}

export async function createMentionsAndNotifications(
  messageId: string,
  channelId: string | null,
  mentionedUserIds: string[],
  authorId: string,
  io: any
): Promise<void> {
  if (mentionedUserIds.length === 0) {
    return;
  }

  let channelName = 'channel';
  if (channelId) {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { name: true },
    });
    if (channel) {
      channelName = channel.name;
    }
  }

  const mentionData = mentionedUserIds.map((userId) => ({
    messageId,
    userId,
  }));

  try {
    await prisma.messageMention.createMany({
      data: mentionData,
      skipDuplicates: true,
    });
  } catch (error) {
    console.error('[mentions] Failed to create mention records:', error);
  }

  const usersToNotify = mentionedUserIds.filter((id) => id !== authorId);
  if (usersToNotify.length === 0) return;

  const usersWithPrefs = await prisma.user.findMany({
    where: { id: { in: usersToNotify } },
    select: {
      id: true,
      timezone: true,
      notificationPreferences: {
        select: {
          level: true,
          muteAll: true,
          tangentReplies: true,
          starredMessagesEvenIfPaused: true,
          newHuddles: true,
          scheduleEnabled: true,
          scheduleMode: true,
          scheduleDays: true,
          scheduleStart: true,
          scheduleEnd: true,
        },
      },
    },
  });

  for (const user of usersWithPrefs) {
    const prefs: NotificationPrefsRaw | null = user.notificationPreferences
      ? { ...user.notificationPreferences, timezone: user.timezone ?? undefined }
      : null;

    const event = { isMention: true, isDirectMessage: false, isChannelMessage: false };
    if (!shouldNotify(prefs, event)) continue;

    try {
      const notification = await NotificationService.createNotification({
        userId: user.id,
        type: 'MENTION',
        title: `You were mentioned in #${channelName}`,
        message: `You were mentioned in ${channelName}`,
        data: {
          messageId,
          channelId,
          type: 'mention',
        },
      });

      if (io) {
        sendToUser(io, user.id, 'mention:new', {
          notificationId: notification.id,
          messageId,
          channelId,
          createdAt: notification.createdAt.toISOString(),
        });
      }
    } catch (error) {
      console.error(`[mentions] Failed to notify user ${user.id}:`, error);
    }
  }
}

export async function updateMentionsForMessage(
  messageId: string,
  channelId: string | null,
  newMentionedUserIds: string[],
  authorId: string,
  io: any
): Promise<void> {
  const existingMentions = await prisma.messageMention.findMany({
    where: { messageId },
    select: { userId: true },
  });

  const existingUserIds = new Set<string>(
    existingMentions.map((m: { userId: string }) => m.userId)
  );
  const newUserIds = new Set<string>(newMentionedUserIds);

  const usersToRemove = Array.from(existingUserIds).filter(
    (id: string) => !newUserIds.has(id)
  );

  const usersToAdd = Array.from(newUserIds).filter(
    (id: string) => !existingUserIds.has(id)
  );

  if (usersToRemove.length > 0) {
    await prisma.messageMention.deleteMany({
      where: {
        messageId,
        userId: { in: usersToRemove },
      },
    });
  }

  if (usersToAdd.length > 0) {
    await createMentionsAndNotifications(
      messageId,
      channelId,
      usersToAdd,
      authorId,
      io
    );
  }
}


