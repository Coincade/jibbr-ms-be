import { Socket, ChannelClientsMap, SendMessageMessage, EditMessageMessage, DeleteMessageMessage, ForwardMessageMessage, MessageData } from '../types.js';
import { broadcastToChannel, validateChannelMembership, getUserInfo } from '../utils.js';
import { sendMessageSchema, updateMessageSchema } from '../../validation/message.validations.js';
import { ZodError } from 'zod';
import { NotificationService } from '../../services/notification.service.js';
import { isFileAttachmentsEnabledForChannel } from '../../helper.js';
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

    // Check if file attachments are enabled for this workspace (if attachments are provided)
    if (data.attachments && data.attachments.length > 0) {
      const attachmentsEnabled = await isFileAttachmentsEnabledForChannel(data.channelId!);
      if (!attachmentsEnabled) {
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
        mentions: {
          include: {
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
        // [mentions] Create mention records and notifications
        if (mentionedUserIds.length > 0) {
          await createMentionsAndNotifications(
            message.id,
            data.channelId!,
            mentionedUserIds,
            socket.data.user.id,
            io
          );
        }

        // Fetch message again with mentions included
        const messageWithMentions = await prisma.message.findUnique({
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
            mentions: {
              include: {
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
        });

        // Broadcast to channel using Socket.IO (to everyone, including sender)
        io.to(data.channelId!).emit('new_message', {
          ...messageWithMentions!,
          createdAt: messageWithMentions!.createdAt.toISOString(),
          updatedAt: messageWithMentions!.updatedAt.toISOString(),
          reactions: messageWithMentions!.reactions.map(reaction => ({
            ...reaction,
            createdAt: reaction.createdAt.toISOString(),
          })),
          attachments: messageWithMentions!.attachments.map(attachment => ({
            ...attachment,
            createdAt: attachment.createdAt.toISOString(),
          })),
          mentions: messageWithMentions!.mentions.map(mention => ({
            ...mention,
            createdAt: mention.createdAt.toISOString(),
          })),
        } as MessageData);
        return;
      }
    }
    // Get channel info for notifications
    const channel = await prisma.channel.findUnique({
      where: { id: data.channelId },
      select: { name: true },
    });

    // [mentions] Create mention records and notifications
    if (mentionedUserIds.length > 0) {
      await createMentionsAndNotifications(
        message.id,
        data.channelId!,
        mentionedUserIds,
        socket.data.user.id,
        io
      );
    }

    // Create notifications for channel members (except sender)
    if (channel) {
      await NotificationService.notifyNewChannelMessage(
        data.channelId!,
        message.id,
        socket.data.user.id,
        payload.content,
        channel.name
      );
    }

    // Fetch message again with mentions included
    const messageWithMentions = await prisma.message.findUnique({
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
        mentions: {
          include: {
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
    });

    // Broadcast to channel using Socket.IO (to everyone, including sender)
    io.to(data.channelId!).emit('new_message', {
      ...messageWithMentions!,
      createdAt: messageWithMentions!.createdAt.toISOString(),
      updatedAt: messageWithMentions!.updatedAt.toISOString(),
      reactions: messageWithMentions!.reactions.map(reaction => ({
        ...reaction,
        createdAt: reaction.createdAt.toISOString(),
      })),
      attachments: messageWithMentions!.attachments.map(attachment => ({
        ...attachment,
        createdAt: attachment.createdAt.toISOString(),
      })),
      mentions: messageWithMentions!.mentions.map(mention => ({
        ...mention,
        createdAt: mention.createdAt.toISOString(),
      })),
    } as MessageData);

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
        mentions: {
          include: {
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

    // Broadcast to target channel using Socket.IO
    socket.to(data.targetChannelId).emit('message_forwarded', {
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
      } as MessageData,
      targetChannelId: data.targetChannelId,
    });

  } catch (error) {
    console.error('Error handling forward message:', error);
    socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to forward message' });
  }
}; 