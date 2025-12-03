// [mentions] Service for processing mentions in messages
import prisma from '../config/database.js';
import { parseMentions } from '../libs/tiptapMentionParser.js';
import { sanitizeMessageHtml } from '../libs/sanitizeHtml.js';
import { checkSpecialMentionRateLimit } from '../libs/rateLimiter.js';
import { sendToUser } from '../websocket/utils.js';
import { NotificationService } from './notification.service.js';

interface ProcessMentionsResult {
  sanitizedContent: string;
  mentionedUserIds: string[];
}

/**
 * Process mentions in message content
 */
export async function processMentions(
  content: string,
  authorId: string,
  channelId: string | null,
  jsonContent?: any
): Promise<ProcessMentionsResult> {
  // Sanitize HTML
  const sanitizedContent = sanitizeMessageHtml(content);

  // Parse mentions from content
  const mentions = parseMentions(sanitizedContent, jsonContent);
  
  // Resolve usernames to userIds (they should already have userIds from HTML data attributes)
  const mentionedUserIds = mentions.map(m => m.userId).filter(Boolean);

  // Handle special mentions (@channel, @here, @everyone)
  // Special mentions are enabled by default, but can be disabled via env vars
  const mentionChannelEnabled = process.env.MENTION_CHANNEL_ENABLED !== 'false';
  const mentionEveryoneEnabled = process.env.MENTION_EVERYONE_ENABLED !== 'false';
  
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

  // Remove duplicates and author's own ID
  const uniqueMentionedIds = Array.from(new Set(mentionedUserIds)).filter(id => id !== authorId);

  return {
    sanitizedContent,
    mentionedUserIds: uniqueMentionedIds
  };
}

/**
 * Handle special mentions (@channel, @here, @everyone)
 */
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

  // Handle @channel and @here (same: all channel members)
  if (hasChannelMention && mentionChannelEnabled) {
    // Rate limit check
    const rateLimitKey = `${authorId}:${channelId}`;
    const maxTokens = parseInt(process.env.MENTION_CHANNEL_MAX_TOKENS || '1', 10);
    const windowSec = parseInt(process.env.MENTION_CHANNEL_RATE_WINDOW_SEC || '120', 10);
    
    const rateLimit = await checkSpecialMentionRateLimit(rateLimitKey, maxTokens, windowSec);
    if (!rateLimit.allowed) {
      console.warn(`[mentions] Rate limit exceeded for @channel mention by ${authorId}`);
      // Don't expand mentions if rate limited
      return [];
    }

    // Get all channel members (excluding author)
    const members = await prisma.channelMember.findMany({
      where: {
        channelId,
        isActive: true,
        userId: { not: authorId }
      },
      select: { userId: true }
    });

    userIds.push(...members.map(m => m.userId));
  }

  // Handle @everyone (requires permission flag)
  if (hasEveryoneMention && mentionEveryoneEnabled) {
    // TODO: Check if user has permission (e.g., is admin/moderator)
    // For now, treat same as @channel
    const members = await prisma.channelMember.findMany({
      where: {
        channelId,
        isActive: true,
        userId: { not: authorId }
      },
      select: { userId: true }
    });

    userIds.push(...members.map(m => m.userId));
  }

  return userIds;
}

/**
 * Create mention records and notifications for a message
 */
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

  // Get channel info for notifications
  let channelName = 'channel';
  if (channelId) {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { name: true }
    });
    if (channel) {
      channelName = channel.name;
    }
  }

  // Create MessageMention records (skip duplicates)
  const mentionData = mentionedUserIds.map(userId => ({
    messageId,
    userId
  }));

  try {
    await prisma.messageMention.createMany({
      data: mentionData,
      skipDuplicates: true
    });
  } catch (error) {
    console.error('[mentions] Failed to create mention records:', error);
  }

  // Create notifications and emit socket events
  for (const userId of mentionedUserIds) {
    // Skip self-mentions
    if (userId === authorId) continue;

    try {
      // Create notification
      const notification = await NotificationService.createNotification({
        userId,
        type: 'MENTION',
        title: `You were mentioned in #${channelName}`,
        message: `You were mentioned in ${channelName}`,
        data: {
          messageId,
          channelId,
          type: 'mention'
        }
      });

      // Emit socket event to user room (only if io is available)
      if (io) {
        sendToUser(io, userId, 'mention:new', {
          notificationId: notification.id,
          messageId,
          channelId,
          createdAt: notification.createdAt.toISOString()
        });
      }
    } catch (error) {
      console.error(`[mentions] Failed to notify user ${userId}:`, error);
    }
  }
}

/**
 * Update mentions for an edited message
 * Removes old mentions and creates new ones
 */
export async function updateMentionsForMessage(
  messageId: string,
  channelId: string | null,
  newMentionedUserIds: string[],
  authorId: string,
  io: any
): Promise<void> {
  // Get existing mentions
  const existingMentions = await prisma.messageMention.findMany({
    where: { messageId },
    select: { userId: true }
  });

  const existingUserIds = new Set<string>(existingMentions.map((m: { userId: string }) => m.userId));
  const newUserIds = new Set<string>(newMentionedUserIds);

  // Find users to remove (were mentioned before, not mentioned now)
  const usersToRemove = Array.from(existingUserIds).filter((id: string) => !newUserIds.has(id));
  
  // Find users to add (not mentioned before, mentioned now)
  const usersToAdd = Array.from(newUserIds).filter((id: string) => !existingUserIds.has(id));

  // Remove old mentions
  if (usersToRemove.length > 0) {
    await prisma.messageMention.deleteMany({
      where: {
        messageId,
        userId: { in: usersToRemove }
      }
    });
  }

  // Add new mentions (this will also create notifications)
  if (usersToAdd.length > 0) {
    await createMentionsAndNotifications(messageId, channelId, usersToAdd, authorId, io);
  }
}

