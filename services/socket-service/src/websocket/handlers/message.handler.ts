import { Socket, ChannelClientsMap, SendMessageMessage, EditMessageMessage, DeleteMessageMessage, ForwardMessageMessage, MessageData } from '../types.js';
import { validateChannelMembership, validateConversationParticipation, getUserInfo } from '../utils.js';
import { sendMessageSchema, updateMessageSchema } from '../../validation/message.validations.js';
import { ZodError } from 'zod';
import { NotificationService } from '../../services/notification.service.js';
import { canUserSendAttachmentsToChannel } from '../../helper.js';
import { processMentions, createMentionsAndNotifications, updateMentionsForMessage } from '../../services/mention.service.js'; // [mentions]
import { htmlToCleanText } from '../../libs/htmlToCleanText.js';

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
    const userId = socket.data.user.id;

    // Validate input
    const payload = sendMessageSchema.parse({
      content: data.content,
      channelId: data.channelId,
      clientMessageId: (data as any).clientMessageId,
      replyToId: data.replyToId,
      isThreadReply: data.isThreadReply,
      forwardedFromMessageId: data.forwardedFromMessageId,
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

    // Idempotency: if the client retries the same message, return the previously created message.
    if (payload.clientMessageId) {
      const existing = await prisma.message.findFirst({
        where: {
          userId: socket.data.user.id,
          clientMessageId: payload.clientMessageId,
        },
        include: {
          user: { select: { id: true, name: true, image: true } },
          replyTo: {
            include: { user: { select: { id: true, name: true } } },
          },
          attachments: true,
          reactions: { include: { user: { select: { id: true, name: true } } } },
        },
      });

      if (existing && !existing.deletedAt) {
        socket.emit('message_sent', {
          id: existing.id,
          clientMessageId: payload.clientMessageId,
          content: existing.content,
          channelId: existing.channelId,
          conversationId: existing.conversationId,
          userId: existing.userId,
          createdAt: existing.createdAt.toISOString(),
          updatedAt: existing.updatedAt.toISOString(),
          replyToId: existing.replyToId,
          isThread: existing.isThread,
          user: {
            id: existing.user.id,
            name: existing.user.name ?? undefined,
            image: existing.user.image ?? undefined,
          },
          attachments: (existing.attachments || []).map((att: any) => ({
            id: att.id,
            filename: att.filename,
            originalName: att.originalName,
            mimeType: att.mimeType,
            size: att.size,
            url: att.url,
            createdAt: att.createdAt.toISOString(),
          })),
          reactions: (existing.reactions || []).map((r: any) => ({
            id: r.id,
            emoji: r.emoji,
            messageId: r.messageId,
            userId: r.userId,
            createdAt: r.createdAt.toISOString(),
            user: { id: r.user.id, name: r.user.name ?? undefined },
          })),
        });
        return;
      }
    }
    
    // If replying, check if the original message exists and is not deleted
    if (payload.replyToId) {
      const originalMessage = await prisma.message.findUnique({
        where: { id: payload.replyToId }
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
        const isSourceMember = await validateChannelMembership(socket.data.user.id, originalMessage.channelId);
        if (!isSourceMember) {
          throw new Error('You do not have access to the original message');
        }
      } else if (originalMessage.conversationId) {
        const isSourceParticipant = await validateConversationParticipation(socket.data.user.id, originalMessage.conversationId);
        if (!isSourceParticipant) {
          throw new Error('You do not have access to the original message');
        }
      }
    }
    
    // [mentions] Process mentions in content
    const { sanitizedContent, mentionedUserIds } = await processMentions(
      payload.content,
      socket.data.user.id,
      payload.channelId,
      (data as any).jsonContent // Optional JSON content from TipTap
    );

    // Store clean text in DB (no HTML tags)
    const contentForDb = htmlToCleanText(sanitizedContent);
    const messageData: any = {
      content: contentForDb,
      channelId: payload.channelId,
      userId: socket.data.user.id,
      replyToId: payload.replyToId,
      clientMessageId: payload.clientMessageId,
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

    // When this is a thread reply, mark parent message as thread so all clients show thread UI (reply count, Tangent link)
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
          channelId: payload.channelId,
        },
      });
      console.log('[handleSendMessage] ForwardedMessage created:', { originalMessageId: payload.forwardedFromMessageId, channelId: payload.channelId });
    }

    // OPTIMIZATION: Broadcast immediately with basic data (Slack-like speed)
    // Attachments and mentions will be added asynchronously
    const attachments = data.attachments || [];
    // Ensure channelId is not null (we're in a channel message handler)
    const channelId = data.channelId!;
    const broadcastMessage: MessageData = {
      id: message.id,
      clientMessageId: payload.clientMessageId,
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
    socket.to(data.channelId!).emit('new_message', {
      ...broadcastMessage,
      ...(parentMessageUpdated && { parentMessageUpdated }),
    });
    
    // Send confirmation to sender with actual message ID (to replace optimistic message)
    socket.emit('message_sent', {
      ...broadcastMessage,
      id: message.id, // Ensure we use the real message ID
      clientMessageId: payload.clientMessageId,
      ...(parentMessageUpdated && { parentMessageUpdated }),
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
            userId,
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
            userId,
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
      clientOpId: (data as any).clientOpId,
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

    const contentForDb = htmlToCleanText(sanitizedContent);
    await prisma.message.update({
      where: { id: data.messageId },
      data: { content: contentForDb },
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
      content: contentForDb,
    });

    if (payload.clientOpId) {
      socket.emit('message_edited_ack', {
        clientOpId: payload.clientOpId,
        messageId: data.messageId,
        channelId: data.channelId,
      });
    }

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

    // Soft delete by setting deletedAt timestamp (keep original content in DB)
    await prisma.message.update({
      where: { id: data.messageId },
      data: { deletedAt: new Date() },
    });

    // Broadcast to channel using Socket.IO
    socket.to(data.channelId!).emit('message_deleted', {
      messageId: data.messageId,
    });

    if ((data as any).clientOpId) {
      socket.emit('message_deleted_ack', {
        clientOpId: (data as any).clientOpId,
        messageId: data.messageId,
        channelId: data.channelId,
      });
    }

  } catch (error) {
    console.error('Error handling delete message:', error);
    socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to delete message' });
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
 * Handle forward message event (channel or DM → channel): creates new Message in target and broadcasts it
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

    const { default: prisma } = await import('../../config/database.js');
    const originalMessage = await prisma.message.findUnique({
      where: { id: data.messageId },
      include: {
        channel: { select: { id: true, name: true } },
        conversation: { select: { id: true } },
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

    // Validate user has access to the original message (channel or DM)
    if (originalMessage.channelId) {
      const isSourceMember = await validateChannelMembership(socket.data.user.id, originalMessage.channelId);
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
    } else {
      throw new Error('Original message has no channel or conversation');
    }

    const isTargetMember = await validateChannelMembership(socket.data.user.id, data.targetChannelId);
    if (!isTargetMember) {
      throw new Error('You are not a member of the target channel');
    }

    const sourceName = originalMessage.channel?.name ?? 'Direct Message';
    const forwardedContent = buildForwardedContent(
      sourceName,
      originalMessage.user.name ?? 'Unknown',
      originalMessage.content
    );
    const contentForDb = htmlToCleanText(forwardedContent);

    const newMessage = await prisma.message.create({
      data: {
        content: contentForDb,
        channelId: data.targetChannelId,
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
        channelId: data.targetChannelId,
      },
    });

    const savedAttachments = await prisma.attachment.findMany({
      where: { messageId: newMessage.id },
    });

    const broadcastMessage: MessageData = {
      id: newMessage.id,
      content: newMessage.content,
      channelId: data.targetChannelId,
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

    socket.to(data.targetChannelId).emit('new_message', broadcastMessage);
    socket.emit('message_sent', { ...broadcastMessage, id: newMessage.id });
  } catch (error) {
    console.error('Error handling forward message:', error);
    socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to forward message' });
  }
};


