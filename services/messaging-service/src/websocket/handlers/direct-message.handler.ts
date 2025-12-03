import { Socket, ConversationClientsMap, SendDirectMessageMessage, EditDirectMessageMessage, DeleteDirectMessageMessage, DirectMessageData } from '../types.js';
import { broadcastToConversation, validateConversationParticipation, getUserInfo, validateChannelMembership } from '../utils.js';
import { sendDirectMessageSchema, updateMessageSchema } from '../../validation/message.validations.js';
import { ZodError } from 'zod';
import { NotificationService } from '../../services/notification.service.js';
import { isFileAttachmentsEnabledForConversation } from '../../helper.js';

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

    // Validate input
    const payload = sendDirectMessageSchema.parse({
      content: data.content,
      conversationId: data.conversationId,
      replyToId: data.replyToId,
      attachments: data.attachments,
    });

    // Validate conversation participation
    const isParticipant = await validateConversationParticipation(socket.data.user.id, data.conversationId);
    if (!isParticipant) {
      throw new Error('You are not a participant of this conversation');
    }

    // Check if file attachments are enabled for this conversation (if attachments are provided)
    if (data.attachments && data.attachments.length > 0) {
      const attachmentsEnabled = await isFileAttachmentsEnabledForConversation(data.conversationId);
      if (!attachmentsEnabled) {
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
        where: { id: payload.replyToId }
      });
      if (!originalMessage || originalMessage.deletedAt) {
        throw new Error('Original message not found or has been deleted');
      }
    }
    
    // Prepare message data
    const messageData: any = {
      content: payload.content,
      conversationId: data.conversationId,
      userId: socket.data.user.id,
      replyToId: payload.replyToId,
    };

    // Create message with attachments if provided
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
        attachments: true,
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    // Create attachments if provided
    if (data.attachments && data.attachments.length > 0) {
      const attachmentData = data.attachments.map(attachment => ({
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

      // Fetch the message again with attachments
      const messageWithAttachments = await prisma.message.findUnique({
        where: { id: message.id },
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
          attachments: true,
          reactions: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      if (messageWithAttachments) {
        // Broadcast to conversation using Socket.IO
        io.to(data.conversationId).emit('new_direct_message', {
          ...messageWithAttachments,
          createdAt: messageWithAttachments.createdAt.toISOString(),
          updatedAt: messageWithAttachments.updatedAt.toISOString(),
          reactions: messageWithAttachments.reactions.map(reaction => ({
            ...reaction,
            createdAt: reaction.createdAt.toISOString(),
          })),
          attachments: messageWithAttachments.attachments.map(attachment => ({
            ...attachment,
            createdAt: attachment.createdAt.toISOString(),
          })),
        } as DirectMessageData);
        return;
      }
    }

    // Create notifications for conversation participants (except sender)
    await NotificationService.notifyNewDirectMessage(
      data.conversationId,
      message.id,
      socket.data.user.id,
      payload.content
    );

    // Broadcast to conversation using Socket.IO
    io.to(data.conversationId).emit('new_direct_message', {
      ...message,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
      reactions: message.reactions.map(reaction => ({
        ...reaction,
        createdAt: reaction.createdAt.toISOString(),
      })),
      attachments: message.attachments.map(attachment => ({
        ...attachment,
        createdAt: attachment.createdAt.toISOString(),
      })),
    } as DirectMessageData);

  } catch (error) {
    if (error instanceof ZodError) {
      socket.emit('error', { message: 'Invalid message data' });
    } else {
      console.error('Error handling send direct message:', error);
      socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to send direct message' });
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
    const isParticipant = await validateConversationParticipation(socket.data.user.id, data.conversationId);
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

    const updatedMessage = await prisma.message.update({
      where: { id: data.messageId },
      data: { content: payload.content },
    });

    // Broadcast to conversation using Socket.IO
    socket.to(data.conversationId).emit('direct_message_edited', {
      messageId: data.messageId,
      content: payload.content,
    });

  } catch (error) {
    if (error instanceof ZodError) {
      socket.emit('error', { message: 'Invalid message data' });
    } else {
      console.error('Error handling edit direct message:', error);
      socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to edit direct message' });
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
    const isParticipant = await validateConversationParticipation(socket.data.user.id, data.conversationId);
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

    // Soft delete by setting deletedAt timestamp
    await prisma.message.update({
      where: { id: data.messageId },
      data: { 
        deletedAt: new Date(),
        content: '[This message was deleted]' // Optional: replace content
      },
    });

    // Broadcast to conversation using Socket.IO
    socket.to(data.conversationId).emit('direct_message_deleted', {
      messageId: data.messageId,
    });

  } catch (error) {
    console.error('Error handling delete direct message:', error);
    socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to delete direct message' });
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
    const isParticipant = await validateConversationParticipation(socket.data.user.id, data.conversationId);
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
    socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to add reaction' });
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
    const isParticipant = await validateConversationParticipation(socket.data.user.id, data.conversationId);
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
    socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to remove reaction' });
  }
}; 

/**
 * Handle forward message to direct conversation event
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

    // Validate conversation participation for target conversation
    const isTargetParticipant = await validateConversationParticipation(socket.data.user.id, data.targetConversationId);
    if (!isTargetParticipant) {
      throw new Error('You are not a participant of the target conversation');
    }

    // Get original message
    const { default: prisma } = await import('../../config/database.js');
    const originalMessage = await prisma.message.findUnique({
      where: { id: data.messageId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        attachments: true,
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!originalMessage) {
      throw new Error('Original message not found');
    }

    // If forwarding from a channel, validate channel membership
    if (originalMessage.channelId) {
      const isSourceMember = await validateChannelMembership(socket.data.user.id, originalMessage.channelId);
      if (!isSourceMember) {
        throw new Error('You are not a member of the source channel');
      }
    } else if (originalMessage.conversationId) {
      // If forwarding from a direct message, validate conversation participation
      const isSourceParticipant = await validateConversationParticipation(socket.data.user.id, originalMessage.conversationId);
      if (!isSourceParticipant) {
        throw new Error('You are not a participant of the source conversation');
      }
    }

    // Create forwarded message record
    await prisma.forwardedMessage.create({
      data: {
        originalMessageId: data.messageId,
        forwardedByUserId: socket.data.user.id,
        conversationId: data.targetConversationId,
      },
    });

    // Broadcast to target conversation using Socket.IO
    socket.to(data.targetConversationId).emit('message_forwarded_to_direct', {
      originalMessage: {
        ...originalMessage,
        createdAt: originalMessage.createdAt.toISOString(),
        updatedAt: originalMessage.updatedAt.toISOString(),
        reactions: originalMessage.reactions.map(reaction => ({
          ...reaction,
          createdAt: reaction.createdAt.toISOString(),
        })),
        attachments: originalMessage.attachments.map(attachment => ({
          ...attachment,
          createdAt: attachment.createdAt.toISOString(),
        })),
      },
      targetConversationId: data.targetConversationId,
    });

  } catch (error) {
    console.error('Error handling forward direct message:', error);
    socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to forward message to direct conversation' });
  }
}; 