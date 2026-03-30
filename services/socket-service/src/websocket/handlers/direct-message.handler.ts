import {
  Socket,
  ConversationClientsMap,
  SendDirectMessageMessage,
  EditDirectMessageMessage,
  DeleteDirectMessageMessage,
  DirectMessageData,
} from '../types.js';
import {
  broadcastToConversation,
  validateConversationParticipation,
  getUserInfo,
  validateChannelMembership,
} from '../utils.js';
import {
  sendDirectMessageSchema,
  updateMessageSchema,
} from '../../validation/message.validations.js';
import { ZodError } from 'zod';
import { NotificationService } from '../../services/notification.service.js';
import { canUserSendAttachmentsToConversation } from '../../helper.js';
import { htmlToCleanText } from '../../libs/htmlToCleanText.js';

/**
 * Handle send direct message event
 */
export const handleSendDirectMessage = async (
  socket: Socket,
  data: SendDirectMessageMessage,
  conversationClients: ConversationClientsMap,
  io: any
): Promise<void> => {
  try {
    if (!socket.data.user) {
      throw new Error('User not authenticated');
    }
    const userId = socket.data.user.id;

    // Validate input
    const payload = sendDirectMessageSchema.parse({
      content: data.content,
      conversationId: data.conversationId,
      replyToId: data.replyToId,
      isThreadReply: data.isThreadReply,
      forwardedFromMessageId: data.forwardedFromMessageId,
      attachments: data.attachments,
    });

    // Validate conversation participation
    const isParticipant = await validateConversationParticipation(
      socket.data.user.id,
      data.conversationId
    );
    if (!isParticipant) {
      throw new Error('You are not a participant of this conversation');
    }

    // Check if user can send attachments (if attachments are provided)
    if (data.attachments && data.attachments.length > 0) {
      const canSendAttachments =
        await canUserSendAttachmentsToConversation(
          data.conversationId,
          socket.data.user.id
        );
      if (!canSendAttachments) {
        throw new Error('File attachments are disabled for this conversation');
      }
    }

    // Get user info
    const userInfo = await getUserInfo(socket.data.user.id);
    if (!userInfo) {
      throw new Error('User not found');
    }

    // Save message to database
    const { default: prisma } = await import('../../config/database.js');

    // If replying, check if the original message exists and is not deleted
    if (payload.replyToId) {
      const originalMessage = await prisma.message.findUnique({
        where: { id: payload.replyToId },
      });
      if (!originalMessage || originalMessage.deletedAt) {
        throw new Error('Original message not found or has been deleted');
      }
    }

    // If forwarding, validate original message and ensure user has access (ForwardedMessage created after message create)
    if (payload.forwardedFromMessageId) {
      const originalMessage = await prisma.message.findUnique({
        where: { id: payload.forwardedFromMessageId },
      });
      if (!originalMessage || originalMessage.deletedAt) {
        throw new Error('Original message not found or has been deleted');
      }
      if (originalMessage.channelId) {
        const isSourceMember = await validateChannelMembership(
          socket.data.user.id,
          originalMessage.channelId
        );
        if (!isSourceMember) {
          throw new Error('You do not have access to the original message');
        }
      } else if (originalMessage.conversationId) {
        const isSourceParticipant = await validateConversationParticipation(
          socket.data.user.id,
          originalMessage.conversationId
        );
        if (!isSourceParticipant) {
          throw new Error('You do not have access to the original message');
        }
      }
    }

    const contentForDb = htmlToCleanText(payload.content);
    const messageData: any = {
      content: contentForDb,
      conversationId: data.conversationId,
      userId: socket.data.user.id,
      replyToId: payload.replyToId,
    };

    // OPTIMIZATION: Create message with minimal includes for faster DB write
    const message = await prisma.message.create({
      data: messageData,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        replyTo: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        // Don't include attachments/reactions here - we'll add them after
      },
    });

    // When this is a thread reply, mark parent message as thread so all clients show thread UI
    let parentMessageUpdated: { id: string; isThread: true } | undefined;
    if (payload.replyToId && payload.isThreadReply) {
      await prisma.message.update({
        where: { id: payload.replyToId },
        data: { isThread: true },
      });
      parentMessageUpdated = { id: payload.replyToId, isThread: true };
    }

    // When forwarding, create ForwardedMessage record so getForwardedMessages is accurate
    if (payload.forwardedFromMessageId) {
      await prisma.forwardedMessage.create({
        data: {
          originalMessageId: payload.forwardedFromMessageId,
          forwardedByUserId: socket.data.user.id,
          conversationId: data.conversationId,
        },
      });
      console.log('[handleSendDirectMessage] ForwardedMessage created:', { originalMessageId: payload.forwardedFromMessageId, conversationId: data.conversationId });
    }

    // OPTIMIZATION: Broadcast immediately with basic data (Slack-like speed)
    // Attachments will be added asynchronously
    const attachments = data.attachments || [];
    const broadcastMessage: DirectMessageData = {
      id: message.id,
      content: message.content,
      conversationId: data.conversationId,
      userId: message.userId,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
      replyToId: message.replyToId,
      user: {
        id: message.user.id,
        name: message.user.name ?? undefined, // Convert null to undefined
        image: message.user.image ?? undefined, // Convert null to undefined
      },
      attachments: attachments.map((att, idx) => ({
        id: `temp-${Date.now()}-${idx}`,
        filename: att.filename,
        originalName: att.originalName,
        mimeType: att.mimeType,
        size: att.size,
        url: att.url,
        createdAt: new Date().toISOString(), // Must be ISO string for AttachmentData type
      })),
      reactions: [],
    };

    // Broadcast immediately (fire and forget) - this is the key to Slack-like speed!
    // Use socket.to() to exclude sender and avoid duplicate messages
    socket.to(data.conversationId).emit('new_direct_message', {
      ...broadcastMessage,
      ...(parentMessageUpdated && { parentMessageUpdated }),
    });
    
    // Send confirmation to sender with actual message ID (to replace optimistic message)
    socket.emit('message_sent', {
      ...broadcastMessage,
      id: message.id, // Ensure we use the real message ID
      ...(parentMessageUpdated && { parentMessageUpdated }),
    });

    // OPTIMIZATION: Save attachments and process notifications asynchronously (don't block)
    (async () => {
      try {
        // Create attachments if provided
        if (attachments.length > 0) {
          const attachmentData = attachments.map((attachment) => ({
            filename: attachment.filename,
            originalName: attachment.originalName,
            mimeType: attachment.mimeType,
            size: attachment.size,
            url: attachment.url,
            messageId: message.id,
          }));

          await prisma.attachment.createMany({
            data: attachmentData,
          });

          // Update broadcast with real attachment IDs (optional - for consistency)
          const savedAttachments = await prisma.attachment.findMany({
            where: { messageId: message.id },
          });

          if (savedAttachments.length > 0) {
            io.to(data.conversationId).emit('direct_message_attachments_updated', {
              messageId: message.id,
              attachments: savedAttachments.map(att => ({
                id: att.id,
                filename: att.filename,
                originalName: att.originalName,
                mimeType: att.mimeType,
                size: att.size,
                url: att.url,
                createdAt: att.createdAt.toISOString(),
              })),
            });
          }
        }

        // Create notifications asynchronously
        await NotificationService.notifyNewDirectMessage(
          data.conversationId,
          message.id,
          userId,
          payload.content
        );
      } catch (error) {
        console.error('[DirectMessageHandler] Error in async processing:', error);
        // Don't throw - message already broadcast
      }
    })();
  } catch (error) {
    if (error instanceof ZodError) {
      socket.emit('error', { message: 'Invalid message data' });
    } else {
      console.error('Error handling send direct message:', error);
      socket.emit('error', {
        message:
          error instanceof Error
            ? error.message
            : 'Failed to send direct message',
      });
    }
  }
};

/**
 * Handle edit direct message event
 */
export const handleEditDirectMessage = async (
  socket: Socket,
  data: EditDirectMessageMessage,
  conversationClients: ConversationClientsMap
): Promise<void> => {
  try {
    if (!socket.data.user) {
      throw new Error('User not authenticated');
    }

    // Validate input
    const payload = updateMessageSchema.parse({
      messageId: data.messageId,
      content: data.content,
    });

    // Validate conversation participation
    const isParticipant = await validateConversationParticipation(
      socket.data.user.id,
      data.conversationId
    );
    if (!isParticipant) {
      throw new Error('You are not a participant of this conversation');
    }

    // Update message in database
    const { default: prisma } = await import('../../config/database.js');
    const message = await prisma.message.findUnique({
      where: { id: data.messageId },
    });

    if (!message) {
      throw new Error('Message not found');
    }

    if (message.userId !== socket.data.user.id) {
      throw new Error('You can only edit your own messages');
    }

    if (message.conversationId !== data.conversationId) {
      throw new Error('Message does not belong to this conversation');
    }

    const contentForDb = htmlToCleanText(payload.content);
    await prisma.message.update({
      where: { id: data.messageId },
      data: { content: contentForDb },
    });

    socket.to(data.conversationId).emit('direct_message_edited', {
      messageId: data.messageId,
      content: contentForDb,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      socket.emit('error', { message: 'Invalid message data' });
    } else {
      console.error('Error handling edit direct message:', error);
      socket.emit('error', {
        message:
          error instanceof Error
            ? error.message
            : 'Failed to edit direct message',
      });
    }
  }
};

/**
 * Handle delete direct message event (Soft Delete)
 */
export const handleDeleteDirectMessage = async (
  socket: Socket,
  data: DeleteDirectMessageMessage,
  conversationClients: ConversationClientsMap
): Promise<void> => {
  try {
    if (!socket.data.user) {
      throw new Error('User not authenticated');
    }

    // Validate conversation participation
    const isParticipant = await validateConversationParticipation(
      socket.data.user.id,
      data.conversationId
    );
    if (!isParticipant) {
      throw new Error('You are not a participant of this conversation');
    }

    // Soft delete message from database
    const { default: prisma } = await import('../../config/database.js');
    const message = await prisma.message.findUnique({
      where: { id: data.messageId },
    });

    if (!message) {
      throw new Error('Message not found');
    }

    if (message.userId !== socket.data.user.id) {
      throw new Error('You can only delete your own messages');
    }

    if (message.conversationId !== data.conversationId) {
      throw new Error('Message does not belong to this conversation');
    }

    // Check if message is already deleted
    if (message.deletedAt) {
      throw new Error('Message is already deleted');
    }

    // Soft delete by setting deletedAt timestamp (keep original content in DB)
    await prisma.message.update({
      where: { id: data.messageId },
      data: { deletedAt: new Date() },
    });

    // Broadcast to conversation using Socket.IO
    socket.to(data.conversationId).emit('direct_message_deleted', {
      messageId: data.messageId,
    });
  } catch (error) {
    console.error('Error handling delete direct message:', error);
    socket.emit('error', {
      message:
        error instanceof Error
          ? error.message
          : 'Failed to delete direct message',
    });
  }
};

/**
 * Handle add reaction to direct message event
 */
export const handleAddDirectReaction = async (
  socket: Socket,
  data: any,
  conversationClients: ConversationClientsMap
): Promise<void> => {
  try {
    if (!socket.data.user) {
      throw new Error('User not authenticated');
    }

    // Validate conversation participation
    const isParticipant = await validateConversationParticipation(
      socket.data.user.id,
      data.conversationId
    );
    if (!isParticipant) {
      throw new Error('You are not a participant of this conversation');
    }

    // Add reaction to database
    const { default: prisma } = await import('../../config/database.js');
    const message = await prisma.message.findUnique({
      where: { id: data.messageId },
    });

    if (!message) {
      throw new Error('Message not found');
    }

    if (message.conversationId !== data.conversationId) {
      throw new Error('Message does not belong to this conversation');
    }

    const reaction = await prisma.reaction.create({
      data: {
        emoji: data.emoji,
        messageId: data.messageId,
        userId: socket.data.user.id,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Broadcast to conversation using Socket.IO
    socket.to(data.conversationId).emit('direct_reaction_added', {
      ...reaction,
      createdAt: reaction.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('Error handling add direct reaction:', error);
    socket.emit('error', {
      message:
        error instanceof Error ? error.message : 'Failed to add reaction',
    });
  }
};

/**
 * Handle remove reaction from direct message event
 */
export const handleRemoveDirectReaction = async (
  socket: Socket,
  data: any,
  conversationClients: ConversationClientsMap
): Promise<void> => {
  try {
    if (!socket.data.user) {
      throw new Error('User not authenticated');
    }

    // Validate conversation participation
    const isParticipant = await validateConversationParticipation(
      socket.data.user.id,
      data.conversationId
    );
    if (!isParticipant) {
      throw new Error('You are not a participant of this conversation');
    }

    // Remove reaction from database
    const { default: prisma } = await import('../../config/database.js');
    const message = await prisma.message.findUnique({
      where: { id: data.messageId },
    });

    if (!message) {
      throw new Error('Message not found');
    }

    if (message.conversationId !== data.conversationId) {
      throw new Error('Message does not belong to this conversation');
    }

    await prisma.reaction.deleteMany({
      where: {
        messageId: data.messageId,
        userId: socket.data.user.id,
        emoji: data.emoji,
      },
    });

    // Broadcast to conversation using Socket.IO
    socket.to(data.conversationId).emit('direct_reaction_removed', {
      messageId: data.messageId,
      emoji: data.emoji,
      userId: socket.data.user.id,
    });
  } catch (error) {
    console.error('Error handling remove direct reaction:', error);
    socket.emit('error', {
      message:
        error instanceof Error ? error.message : 'Failed to remove reaction',
    });
  }
};

function buildForwardedContent(sourceName: string, originalSenderName: string, originalContent: string): string {
  const cleanContent = (originalContent || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
  return `**Forwarded from ${sourceName} by @${originalSenderName}**\n\n${cleanContent}`;
}

/**
 * Handle forward message to direct conversation event (channel/DM → DM): creates new Message in target and emits it
 */
export const handleForwardDirectMessage = async (
  socket: Socket,
  data: any,
  conversationClients: ConversationClientsMap
): Promise<void> => {
  try {
    if (!socket.data.user) {
      throw new Error('User not authenticated');
    }

    const isTargetParticipant = await validateConversationParticipation(
      socket.data.user.id,
      data.targetConversationId
    );
    if (!isTargetParticipant) {
      throw new Error('You are not a participant of the target conversation');
    }

    const { default: prisma } = await import('../../config/database.js');
    const originalMessage = await prisma.message.findUnique({
      where: { id: data.messageId },
      include: {
        channel: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, image: true } },
        attachments: true,
      },
    });

    if (!originalMessage) {
      throw new Error('Original message not found');
    }
    if (originalMessage.deletedAt) {
      throw new Error('Cannot forward a deleted message');
    }

    if (originalMessage.channelId) {
      const isSourceMember = await validateChannelMembership(
        socket.data.user.id,
        originalMessage.channelId
      );
      if (!isSourceMember) {
        throw new Error('You are not a member of the source channel');
      }
    } else if (originalMessage.conversationId) {
      const isSourceParticipant = await validateConversationParticipation(
        socket.data.user.id,
        originalMessage.conversationId
      );
      if (!isSourceParticipant) {
        throw new Error('You are not a participant of the source conversation');
      }
    }

    const sourceName = originalMessage.channel?.name ?? 'Direct message';
    const forwardedContent = buildForwardedContent(
      sourceName,
      originalMessage.user.name ?? 'Unknown',
      originalMessage.content
    );
    const contentForDb = htmlToCleanText(forwardedContent);

    const newMessage = await prisma.message.create({
      data: {
        content: contentForDb,
        conversationId: data.targetConversationId,
        userId: socket.data.user.id,
      },
      include: {
        user: { select: { id: true, name: true, image: true } },
      },
    });

    if (originalMessage.attachments.length > 0) {
      await prisma.attachment.createMany({
        data: originalMessage.attachments.map((att) => ({
          filename: att.filename,
          originalName: att.originalName,
          mimeType: att.mimeType,
          size: att.size,
          url: att.url,
          messageId: newMessage.id,
        })),
      });
    }

    await prisma.forwardedMessage.create({
      data: {
        originalMessageId: data.messageId,
        forwardedByUserId: socket.data.user.id,
        conversationId: data.targetConversationId,
      },
    });

    const savedAttachments = await prisma.attachment.findMany({
      where: { messageId: newMessage.id },
    });

    const broadcastMessage: DirectMessageData = {
      id: newMessage.id,
      content: newMessage.content,
      conversationId: data.targetConversationId,
      userId: newMessage.userId,
      createdAt: newMessage.createdAt.toISOString(),
      updatedAt: newMessage.updatedAt.toISOString(),
      replyToId: newMessage.replyToId,
      user: {
        id: newMessage.user.id,
        name: newMessage.user.name ?? undefined,
        image: newMessage.user.image ?? undefined,
      },
      attachments: savedAttachments.map((att) => ({
        id: att.id,
        filename: att.filename,
        originalName: att.originalName,
        mimeType: att.mimeType,
        size: att.size,
        url: att.url,
        createdAt: att.createdAt.toISOString(),
      })),
      reactions: [],
    };

    socket.to(data.targetConversationId).emit('new_direct_message', broadcastMessage);
    socket.emit('message_sent', { ...broadcastMessage, id: newMessage.id });
  } catch (error) {
    console.error('Error handling forward direct message:', error);
    socket.emit('error', {
      message:
        error instanceof Error
          ? error.message
          : 'Failed to forward message to direct conversation',
    });
  }
};


