import type { Socket } from '../types.js';
import prisma from '../../config/database.js';
import { z } from 'zod';

const markAsReadSchema = z.object({
  channelId: z.string().optional(),
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
});

export type MarkAsReadPayload = z.infer<typeof markAsReadSchema>;

/**
 * Handle mark_as_read socket event.
 * Updates ChannelMember.lastReadAt or ConversationReadStatus.lastReadAt
 * and touches UserRecent for recents tracking.
 * Mirrors logic from messaging-service notification.controller markAsRead.
 */
export const handleMarkAsRead = async (
  socket: Socket,
  data: MarkAsReadPayload
): Promise<void> => {
  const user = socket.data.user;
  if (!user) {
    socket.emit('error', { message: 'User not authenticated' });
    return;
  }

  try {
    const payload = markAsReadSchema.parse(data || {});

    if (!payload.channelId && !payload.conversationId) {
      socket.emit('error', { message: 'channelId or conversationId is required' });
      return;
    }

    if (payload.channelId) {
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
        socket.emit('error', { message: 'You are not a member of this channel' });
        return;
      }

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

      await prisma.userRecent.upsert({
        where: {
          userId_workspaceId_type_targetId: {
            userId: user.id,
            workspaceId: channelMember.channel.workspaceId,
            type: 'CHANNEL',
            targetId: payload.channelId,
          },
        },
        create: {
          userId: user.id,
          workspaceId: channelMember.channel.workspaceId,
          type: 'CHANNEL',
          targetId: payload.channelId,
          lastOpenedAt: new Date(),
        },
        update: { lastOpenedAt: new Date() },
      });
    } else if (payload.conversationId) {
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
        socket.emit('error', { message: 'You are not a participant of this conversation' });
        return;
      }

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

      await prisma.userRecent.upsert({
        where: {
          userId_workspaceId_type_targetId: {
            userId: user.id,
            workspaceId: participant.conversation.workspaceId,
            type: 'CONVERSATION',
            targetId: payload.conversationId,
          },
        },
        create: {
          userId: user.id,
          workspaceId: participant.conversation.workspaceId,
          type: 'CONVERSATION',
          targetId: payload.conversationId,
          lastOpenedAt: new Date(),
        },
        update: { lastOpenedAt: new Date() },
      });
    }

    socket.emit('mark_as_read_ack', { success: true, ...payload });
  } catch (error) {
    if (error instanceof z.ZodError) {
      socket.emit('error', { message: 'Invalid mark_as_read data' });
      return;
    }
    console.error('[mark_as_read] Error:', error);
    socket.emit('error', { message: 'Failed to mark as read' });
  }
};
