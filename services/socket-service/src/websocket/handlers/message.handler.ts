import { Socket, ChannelClientsMap, SendMessageMessage, EditMessageMessage, DeleteMessageMessage, ForwardMessageMessage, MessageData } from '../types.js';
import { broadcastToChannel, validateChannelMembership, getUserInfo } from '../utils.js';
import { sendMessageSchema, updateMessageSchema } from '../../validation/message.validations.js';
import { ZodError } from 'zod';
import { NotificationService } from '../../services/notification.service.js';
import { canUserSendAttachmentsToChannel } from '../../helper.js';
import { processMentions, createMentionsAndNotifications, updateMentionsForMessage } from '../../services/mention.service.js'; // [mentions]

/**
 * Handle send message event
 */
export const handleSendMessage = async (
  socket: Socket,
  data: SendMessageMessage,
  channelClients: ChannelClientsMap,
  io: any // <-- add io parameter
): Promise<void> => {
  try {
    if (!socket.data.user) {
      throw new Error('User not authenticated');
    }

    // Validate input
    const payload = sendMessageSchema.parse({
      content: data.content,
      channelId: data.channelId,
      replyToId: data.replyToId,
      attachments: data.attachments,
    });

    // Validate channel membership
    const isMember = await validateChannelMembership(socket.data.user.id, data.channelId!);
    if (!isMember) {
      throw new Error('You are not a member of this channel');
    }

    // Check if user can send attachments (if attachments are provided)
    if (data.attachments && data.attachments.length > 0) {
      const canSendAttachments = await canUserSendAttachmentsToChannel(
        data.channelId!,
        socket.data.user.id
      );
      if (!canSendAttachments) {
        throw new Error('File attachments are disabled for this workspace');
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
    
    // [mentions] Process mentions in content
    const { sanitizedContent, mentionedUserIds } = await processMentions(
      payload.content,
      socket.data.user.id,
      payload.channelId,
      (data as any).jsonContent // Optional JSON content from TipTap
    );

    // Prepare message data
    const messageData: any = {
      content: sanitizedContent, // Use sanitized content
      channelId: payload.channelId,
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
        // Don't include attachments/reactions/mentions here - we'll add them after
      },
    });

    // OPTIMIZATION: Broadcast immediately with basic data (Slack-like speed)
    // Attachments and mentions will be added asynchronously
    const attachments = data.attachments || [];
    // Ensure channelId is not null (we're in a channel message handler)
    const channelId = data.channelId!;
    const broadcastMessage: MessageData = {
      id: message.id,
      content: message.content,
      channelId: channelId, // Use the validated channelId from data
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
    // Use socket.to() to exclude sender and avoid duplicate messages (sender gets message_sent)
    socket.to(data.channelId!).emit('new_message', broadcastMessage);
    
    // Send confirmation to sender with actual message ID (to replace optimistic message)
    socket.emit('message_sent', {
      ...broadcastMessage,
      id: message.id, // Ensure we use the real message ID
    });

    // OPTIMIZATION: Save attachments and process mentions asynchronously (don't block)
    (async () => {
      try {
        // Create attachments if provided
        if (attachments.length > 0) {
          const attachmentData = attachments.map(attachment => ({
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
            io.to(data.channelId!).emit('message_attachments_updated', {
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

        // Process mentions asynchronously
        if (mentionedUserIds.length > 0) {
          await createMentionsAndNotifications(
            message.id,
            data.channelId!,
            mentionedUserIds,
            socket.data.user.id,
            io
          );

          // Update broadcast with mentions (optional - for consistency)
          const savedMentions = await prisma.messageMention.findMany({
            where: { messageId: message.id },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                },
              },
            },
          });

          if (savedMentions.length > 0) {
            io.to(data.channelId!).emit('message_mentions_updated', {
              messageId: message.id,
              mentions: savedMentions.map(mention => ({
                ...mention,
                createdAt: mention.createdAt.toISOString(),
              })),
            });
          }
        }

        // Create notifications asynchronously
        const channel = await prisma.channel.findUnique({
          where: { id: data.channelId },
          select: { name: true },
        });

        if (channel) {
          await NotificationService.notifyNewChannelMessage(
            data.channelId!,
            message.id,
            socket.data.user.id,
            payload.content,
            channel.name
          );
        }
      } catch (error) {
        console.error('[MessageHandler] Error in async processing:', error);
        // Don't throw - message already broadcast
      }
    })();

  } catch (error) {
    if (error instanceof ZodError) {
      socket.emit('error', { message: 'Invalid message data' });
    } else {
      console.error('Error handling send message:', error);
      socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to send message' });
    }
  }
};

/**
 * Handle edit message event
 */
export const handleEditMessage = async (
  socket: Socket,
  data: EditMessageMessage,
  channelClients: ChannelClientsMap,
  io: any
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

    // Validate channel membership
    const isMember = await validateChannelMembership(socket.data.user.id, data.channelId!);
    if (!isMember) {
      throw new Error('You are not a member of this channel');
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

    // [mentions] Process mentions in updated content
    const { sanitizedContent, mentionedUserIds } = await processMentions(
      payload.content,
      socket.data.user.id,
      message.channelId,
      (data as any).jsonContent // Optional JSON content from TipTap
    );

    await prisma.message.update({
      where: { id: data.messageId },
      data: { content: sanitizedContent }, // Use sanitized content
    });

    // [mentions] Update mentions (remove old, add new)
    await updateMentionsForMessage(
      data.messageId,
      message.channelId,
      mentionedUserIds,
      socket.data.user.id,
      io
    );

    // Broadcast to channel using Socket.IO
    socket.to(data.channelId!).emit('message_edited', {
      messageId: data.messageId,
      content: sanitizedContent,
    });

  } catch (error) {
    console.error('Error handling edit message:', error);
    socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to edit message' });
  }
};

/**
 * Handle delete message event (Soft Delete)
 */
export const handleDeleteMessage = async (
  socket: Socket,
  data: DeleteMessageMessage,
  channelClients: ChannelClientsMap
): Promise<void> => {
  try {
    if (!socket.data.user) {
      throw new Error('User not authenticated');
    }

    // Validate channel membership
    const isMember = await validateChannelMembership(socket.data.user.id, data.channelId!);
    if (!isMember) {
      throw new Error('You are not a member of this channel');
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

    // Broadcast to channel using Socket.IO
    socket.to(data.channelId!).emit('message_deleted', {
      messageId: data.messageId,
    });

  } catch (error) {
    console.error('Error handling delete message:', error);
    socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to delete message' });
  }
};

/**
 * Handle forward message event
 */
export const handleForwardMessage = async (
  socket: Socket,
  data: ForwardMessageMessage,
  channelClients: ChannelClientsMap
): Promise<void> => {
  try {
    if (!socket.data.user) {
      throw new Error('User not authenticated');
    }

    // Validate channel membership for both source and target channels
    const isSourceMember = await validateChannelMembership(socket.data.user.id, data.channelId);
    const isTargetMember = await validateChannelMembership(socket.data.user.id, data.targetChannelId);
    
    if (!isSourceMember || !isTargetMember) {
      throw new Error('You are not a member of one or both channels');
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

    // Create forwarded message record
    await prisma.forwardedMessage.create({
      data: {
        originalMessageId: data.messageId,
        forwardedByUserId: socket.data.user.id,
        channelId: data.targetChannelId,
      },
    });

    // Broadcast forwarded message event to target channel
    const messageData: MessageData = {
      id: originalMessage.id,
      content: originalMessage.content,
      channelId: data.targetChannelId,
      userId: originalMessage.userId,
      createdAt: originalMessage.createdAt.toISOString(),
      updatedAt: originalMessage.updatedAt.toISOString(),
      replyToId: originalMessage.replyToId,
      user: {
        id: originalMessage.user.id,
        name: originalMessage.user.name || undefined,
        image: originalMessage.user.image || undefined,
      },
      attachments: originalMessage.attachments.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        url: attachment.url,
        createdAt: attachment.createdAt.toISOString(),
      })),
      reactions: originalMessage.reactions.map((reaction) => ({
        id: reaction.id,
        emoji: reaction.emoji,
        messageId: reaction.messageId,
        userId: reaction.userId,
        createdAt: reaction.createdAt.toISOString(),
        user: {
          id: reaction.user.id,
          name: reaction.user.name || undefined,
        },
      })),
    };

    // Broadcast forwarded message event to target channel (including sender)
    socket.nsp.to(data.targetChannelId).emit('message_forwarded', {
      originalMessage: messageData,
      targetChannelId: data.targetChannelId,
    });

  } catch (error) {
    console.error('Error handling forward message:', error);
    socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to forward message' });
  }
};


