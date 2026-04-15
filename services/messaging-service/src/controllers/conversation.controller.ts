import {
  formatError,
  isFileAttachmentsEnabledForConversation,
  canUserSendAttachmentsToConversation,
  canUserForwardInTownhall,
  isTownhallChannelName,
} from "../helper.js";
import { Request, Response } from "express";
import prisma from "../config/database.js";
import { uploadToSpaces, deleteFromSpaces } from "../config/upload.js";
import { z, ZodError } from "zod";
import { publishMessageCreatedEvent, publishMessageDeletedEvent } from "../services/streams-publisher.service.js";
import { buildForwardedContent } from "./message.controller.js";
import { htmlToCleanText } from "../libs/htmlToCleanText.js";

// Get or create conversation between two users (workspace-specific)
export const getOrCreateConversation = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const { targetUserId } = req.params;
    const { workspaceId } = req.query;

    if (!targetUserId) {
      return res.status(400).json({ message: "Target user ID is required" });
    }

    if (!workspaceId || typeof workspaceId !== 'string') {
      return res.status(400).json({ message: "Workspace ID is required" });
    }

    if (user.id === targetUserId) {
      return res.status(400).json({ message: "Cannot create conversation with yourself" });
    }

    // Verify workspace exists and user is a member
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        members: {
          where: {
            userId: user.id,
            isActive: true
          }
        }
      }
    });

    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    if (workspace.members.length === 0) {
      return res.status(403).json({ message: "You are not a member of this workspace" });
    }

    // Check if target user exists and is a member of the workspace
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { 
        id: true, 
        name: true, 
        image: true,
        members: {
          where: {
            workspaceId: workspaceId,
            isActive: true
          }
        }
      }
    });

    if (!targetUser) {
      return res.status(404).json({ message: "Target user not found" });
    }

    if (targetUser.members.length === 0) {
      return res.status(403).json({ message: "Target user is not a member of this workspace" });
    }

    // Check if conversation already exists in this workspace
    // Find conversations where both users are active participants AND it's in this workspace
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        workspaceId: workspaceId, // Filter by workspace
        AND: [
          {
            participants: {
              some: {
                userId: user.id,
                isActive: true
              }
            }
          },
          {
            participants: {
              some: {
                userId: targetUserId,
                isActive: true
              }
            }
          }
        ]
      },
      include: {
        participants: {
          where: {
            isActive: true
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                image: true
              }
            }
          }
        },
        messages: {
          where: {
            deletedAt: null
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 1,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                image: true
              }
            }
          }
        }
      }
    });

    if (existingConversation && existingConversation.participants.length === 2) {
      // Check if file attachments are enabled for this conversation
      const attachmentsEnabled = await isFileAttachmentsEnabledForConversation(existingConversation.id);
      
      return res.status(200).json({
        message: "Conversation found",
        data: {
          id: existingConversation.id,
          workspaceId: existingConversation.workspaceId,
          participants: existingConversation.participants.map(p => ({
            id: p.id,
            userId: p.userId,
            user: p.user,
            isActive: p.isActive,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt
          })),
          lastMessage: existingConversation.messages[0] || null,
          fileAttachmentsEnabled: attachmentsEnabled
        }
      });
    }

    // Create new conversation in this workspace
    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: workspaceId, // Associate with workspace
        participants: {
          create: [
            { userId: user.id, isActive: true },
            { userId: targetUserId, isActive: true }
          ]
        }
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                image: true
              }
            }
          }
        }
      }
    });

    // Check if file attachments are enabled for this conversation
    const attachmentsEnabled = await isFileAttachmentsEnabledForConversation(conversation.id);
    
    return res.status(201).json({
      message: "Conversation created successfully",
      data: {
        id: conversation.id,
        workspaceId: conversation.workspaceId,
        participants: conversation.participants.map(p => ({
          id: p.id,
          userId: p.userId,
          user: p.user,
          isActive: p.isActive,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt
        })),
        lastMessage: null,
        fileAttachmentsEnabled: attachmentsEnabled
      }
    });
  } catch (error) {
    console.error('Error in getOrCreateConversation:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get user's conversations (workspace-specific)
export const getUserConversations = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const { workspaceId } = req.query;

    // Build where clause - filter by workspace if provided
    const whereClause: any = {
      participants: {
        some: {
          userId: user.id,
          isActive: true
        }
      }
    };

    if (workspaceId && typeof workspaceId === 'string') {
      whereClause.workspaceId = workspaceId;
    }

    console.log('[getUserConversations] Fetching conversations for user:', user.id, 'workspaceId:', workspaceId || 'all');

    // Find all conversations where the user is an active participant
    const conversations = await prisma.conversation.findMany({
      where: whereClause,
      include: {
        participants: {
          where: {
            isActive: true  // Only include active participants in the response
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                image: true
              }
            }
          }
        },
        messages: {
          where: {
            deletedAt: null  // Exclude soft-deleted messages
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 1,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                image: true
              }
            }
          }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    console.log('[getUserConversations] Found', conversations.length, 'conversations');

    const responseData = conversations.map(conv => {
      // Filter out the current user from participants for cleaner response
      const otherParticipants = conv.participants.filter(p => p.userId !== user.id);
      
      return {
        id: conv.id,
        workspaceId: conv.workspaceId,
        participants: conv.participants.map(p => ({
          id: p.id,
          userId: p.userId,
          user: p.user,
          isActive: p.isActive,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt
        })),
        lastMessage: conv.messages[0] || null
      };
    });

    return res.status(200).json({
      message: "Conversations fetched successfully",
      data: responseData
    });
  } catch (error) {
    console.error('Error in getUserConversations:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get conversation messages
export const getConversationMessages = async (req: Request, res: Response) => {
  const startAt = Date.now();
  let queryMs = 0;
  let countMs = 0;
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const { conversationId } = req.params;
    const { page = 1, limit = 50, before } = req.query;
    const beforeDate = before ? new Date(String(before)) : null;
    if (beforeDate && Number.isNaN(beforeDate.getTime())) {
      return res.status(400).json({ message: "Invalid before cursor" });
    }

    // Check if user is participant of the conversation
    const participant = await prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId: user.id,
        isActive: true
      }
    });

    if (!participant) {
      return res.status(403).json({ message: "You are not a participant of this conversation" });
    }

    const useCursor = !!beforeDate;
    const skip = useCursor ? 0 : (Number(page) - 1) * Number(limit);
    const queryStartAt = Date.now();

    const messages = await prisma.message.findMany({
      where: {
        conversationId,
        deletedAt: null, // Exclude soft-deleted messages
        ...(useCursor && beforeDate ? { createdAt: { lt: beforeDate } } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true
          }
        },
        replyTo: {
          include: {
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        attachments: true,
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip,
      take: Number(limit)
    });
    queryMs = Date.now() - queryStartAt;

    const countStartAt = Date.now();
    const total = await prisma.message.count({
      where: {
        conversationId,
        deletedAt: null // Exclude soft-deleted messages
      }
    });
    countMs = Date.now() - countStartAt;
    const nextCursor = messages.length > 0 ? messages[messages.length - 1].createdAt.toISOString() : null;

    return res.status(200).json({
      message: "Messages fetched successfully",
      data: {
        messages: messages.map(msg => ({
          ...msg,
          createdAt: msg.createdAt.toISOString(),
          updatedAt: msg.updatedAt.toISOString(),
          reactions: msg.reactions.map(reaction => ({
            ...reaction,
            createdAt: reaction.createdAt.toISOString()
          })),
          attachments: msg.attachments.map(attachment => ({
            ...attachment,
            createdAt: attachment.createdAt.toISOString()
          }))
        })),
        nextCursor,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error) {
    console.error('Error in getConversationMessages:', error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    const totalMs = Date.now() - startAt;
    console.log('[getConversationMessages] timings:', {
      conversationId: req.params?.conversationId,
      page: req.query?.page,
      limit: req.query?.limit,
      before: req.query?.before,
      queryMs,
      countMs,
      totalMs,
    });
  }
};

// Send direct message
export const sendDirectMessage = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const { conversationId } = req.params;
    const { content, replyToId } = req.body;

    if (!content) {
      return res.status(400).json({ message: "Message content is required" });
    }

    // Check if user is participant of the conversation
    const participant = await prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId: user.id,
        isActive: true
      }
    });

    if (!participant) {
      return res.status(403).json({ message: "You are not a participant of this conversation" });
    }

    // If replying, check if the original message exists
    if (replyToId) {
      const originalMessage = await prisma.message.findUnique({
        where: { id: replyToId }
      });
      if (!originalMessage) {
        return res.status(404).json({ message: "Original message not found" });
      }
    }

    // Create the message
    const message = await prisma.message.create({
      data: {
        content,
        conversationId,
        userId: user.id,
        replyToId
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true
          }
        },
        replyTo: {
          include: {
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        attachments: true,
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    // Publish Streams event (async, don't await)
    publishMessageCreatedEvent(message).catch(err => 
      console.error('[Streams] Failed to publish message.created event:', err)
    );

    return res.status(201).json({
      message: "Direct message sent successfully",
      data: {
        ...message,
        createdAt: message.createdAt.toISOString(),
        updatedAt: message.updatedAt.toISOString(),
        reactions: message.reactions.map(reaction => ({
          ...reaction,
          createdAt: reaction.createdAt.toISOString()
        })),
        attachments: message.attachments.map(attachment => ({
          ...attachment,
          createdAt: attachment.createdAt.toISOString()
        }))
      }
    });
  } catch (error) {
    console.error('Error in sendDirectMessage:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const forwardToConversationSchema = z.object({
  messageId: z.string().min(1, "Message ID is required"),
});

// Forward a message to a conversation (DM). Creates new Message + ForwardedMessage record.
export const forwardToDirectMessage = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const { conversationId } = req.params;
    const payload = forwardToConversationSchema.parse(req.body);

    // Check user is participant of the target conversation
    const participant = await prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId: user.id,
        isActive: true,
      },
    });
    if (!participant) {
      return res.status(403).json({ message: "You are not a participant of this conversation" });
    }

    // Load original message with source context
    const originalMessage = await prisma.message.findUnique({
      where: { id: payload.messageId },
      include: {
        channel: { select: { id: true, name: true, workspaceId: true } },
        conversation: { select: { id: true } },
        user: { select: { id: true, name: true, image: true } },
        attachments: true,
      },
    });

    if (!originalMessage) {
      return res.status(404).json({ message: "Original message not found" });
    }
    if (originalMessage.deletedAt) {
      return res.status(400).json({ message: "Cannot forward a deleted message" });
    }

    // Ensure user has access to the original message
    if (originalMessage.channelId) {
      const member = await prisma.channelMember.findFirst({
        where: {
          channelId: originalMessage.channelId,
          userId: user.id,
          isActive: true,
        },
      });
      if (!member) {
        return res.status(403).json({ message: "You do not have access to the original message" });
      }
    } else if (originalMessage.conversationId) {
      const origParticipant = await prisma.conversationParticipant.findFirst({
        where: {
          conversationId: originalMessage.conversationId,
          userId: user.id,
          isActive: true,
        },
      });
      if (!origParticipant) {
        return res.status(403).json({ message: "You do not have access to the original message" });
      }
    }

    if (isTownhallChannelName(originalMessage.channel?.name) && originalMessage.channel?.workspaceId) {
      const allowed = await canUserForwardInTownhall(originalMessage.channel.workspaceId, user.id);
      if (!allowed) {
        return res.status(403).json({
          message: "Only admins and moderators can forward messages in #Townhall",
        });
      }
    }

    const sourceName = originalMessage.channel?.name ?? "Direct Message";
    const forwardedContent = buildForwardedContent(
      sourceName,
      originalMessage.user.name ?? "Unknown",
      originalMessage.content
    );
    const contentForDb = htmlToCleanText(forwardedContent);

    const newMessage = await prisma.message.create({
      data: {
        content: contentForDb,
        conversationId,
        userId: user.id,
      },
      include: {
        user: { select: { id: true, name: true, image: true } },
        attachments: true,
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
        originalMessageId: payload.messageId,
        forwardedByUserId: user.id,
        conversationId,
      },
    });

    const messageWithAttachments = await prisma.message.findUnique({
      where: { id: newMessage.id },
      include: {
        user: { select: { id: true, name: true, image: true } },
        attachments: true,
      },
    });

    publishMessageCreatedEvent(messageWithAttachments!).catch((err) =>
      console.error("[Streams] Failed to publish message.created event:", err)
    );

    return res.status(201).json({
      message: "Message forwarded successfully",
      data: {
        message: {
          ...messageWithAttachments,
          createdAt: messageWithAttachments!.createdAt.toISOString(),
          updatedAt: messageWithAttachments!.updatedAt.toISOString(),
          attachments: messageWithAttachments!.attachments.map((a) => ({
            ...a,
            createdAt: a.createdAt.toISOString(),
          })),
        },
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(422).json({ message: "Invalid data", errors: formatError(error) });
    }
    console.error("Error in forwardToDirectMessage:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Send direct message with attachments
export const sendDirectMessageWithAttachments = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const { conversationId } = req.params;
    const { content, replyToId } = req.body;

    if (!content) {
      return res.status(400).json({ message: "Message content is required" });
    }

    // Check if user is participant of the conversation
    const participant = await prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId: user.id,
        isActive: true
      }
    });

    if (!participant) {
      return res.status(403).json({ message: "You are not a participant of this conversation" });
    }

    // Check if user can send attachments (enabled for workspace, or user is admin/moderator)
    const canSendAttachments = await canUserSendAttachmentsToConversation(conversationId, user.id);
    if (!canSendAttachments) {
      return res.status(403).json({ 
        message: "File attachments are disabled for this conversation" 
      });
    }

    // If replying, check if the original message exists
    if (replyToId) {
      const originalMessage = await prisma.message.findUnique({
        where: { id: replyToId }
      });
      if (!originalMessage) {
        return res.status(404).json({ message: "Original message not found" });
      }
    }

    // Upload attachments if any
    const attachments = [];
    if (req.files && Array.isArray(req.files)) {
      for (const file of req.files) {
        const fileUrl = await uploadToSpaces(file);
        attachments.push({
          filename: file.filename || file.originalname,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          url: fileUrl
        });
      }
    }

    // Create the message with attachments
    const message = await prisma.message.create({
      data: {
        content,
        conversationId,
        userId: user.id,
        replyToId,
        attachments: {
          create: attachments
        }
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true
          }
        },
        replyTo: {
          include: {
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        attachments: true,
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    // Publish Streams event (async, don't await)
    publishMessageCreatedEvent(message).catch(err => 
      console.error('[Streams] Failed to publish message.created event:', err)
    );

    return res.status(201).json({
      message: "Direct message sent successfully",
      data: {
        ...message,
        createdAt: message.createdAt.toISOString(),
        updatedAt: message.updatedAt.toISOString(),
        reactions: message.reactions.map(reaction => ({
          ...reaction,
          createdAt: reaction.createdAt.toISOString()
        })),
        attachments: message.attachments.map(attachment => ({
          ...attachment,
          createdAt: attachment.createdAt.toISOString()
        }))
      }
    });
  } catch (error) {
    console.error('Error in sendDirectMessageWithAttachments:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete a direct message (Soft Delete)
export const deleteDirectMessage = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const { conversationId, messageId } = req.params;

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: true,
        attachments: true,
      },
    });

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Check if message is already deleted
    if (message.deletedAt) {
      return res.status(400).json({ message: "Message is already deleted" });
    }

    // Check if message belongs to the specified conversation
    if (message.conversationId !== conversationId) {
      return res.status(400).json({ message: "Message does not belong to this conversation" });
    }

    // Check if user is participant of the conversation
    const participant = await prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId: user.id,
        isActive: true
      }
    });

    if (!participant) {
      return res.status(403).json({ message: "You are not a participant of this conversation" });
    }

    // Only message author can delete
    if (message.userId !== user.id) {
      return res.status(403).json({ message: "You can only delete your own messages" });
    }

    // Soft delete the message (keep original content in DB)
    const deletedMessage = await prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });

    // Publish Streams event (async, don't await)
    publishMessageDeletedEvent(deletedMessage).catch(err => 
      console.error('[Streams] Failed to publish message.deleted event:', err)
    );

    return res.status(200).json({
      message: "Direct message deleted successfully",
    });
  } catch (error) {
    console.error('Error in deleteDirectMessage:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
}; 