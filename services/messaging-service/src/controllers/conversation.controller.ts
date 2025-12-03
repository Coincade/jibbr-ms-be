import { formatError, isFileAttachmentsEnabledForConversation } from "../helper.js";
import { Request, Response } from "express";
import prisma from "../config/database.js";
import { uploadToSpaces, deleteFromSpaces } from "../config/upload.js";
import { ZodError } from "zod";

// Get or create conversation between two users
export const getOrCreateConversation = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const { targetUserId } = req.params;

    if (!targetUserId) {
      return res.status(400).json({ message: "Target user ID is required" });
    }

    if (user.id === targetUserId) {
      return res.status(400).json({ message: "Cannot create conversation with yourself" });
    }

    // Check if target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, image: true }
    });

    if (!targetUser) {
      return res.status(404).json({ message: "Target user not found" });
    }

    // Check if conversation already exists
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        participants: {
          every: {
            userId: {
              in: [user.id, targetUserId]
            },
            isActive: true
          }
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
        },
        messages: {
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
      return res.status(200).json({
        message: "Conversation found",
        data: {
          id: existingConversation.id,
          participants: existingConversation.participants.map(p => ({
            id: p.id,
            userId: p.userId,
            user: p.user,
            isActive: p.isActive,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt
          })),
          lastMessage: existingConversation.messages[0] || null
        }
      });
    }

    // Create new conversation
    const conversation = await prisma.conversation.create({
      data: {
        participants: {
          create: [
            { userId: user.id },
            { userId: targetUserId }
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

    return res.status(201).json({
      message: "Conversation created successfully",
      data: {
        id: conversation.id,
        participants: conversation.participants.map(p => ({
          id: p.id,
          userId: p.userId,
          user: p.user,
          isActive: p.isActive,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt
        })),
        lastMessage: null
      }
    });
  } catch (error) {
    console.error('Error in getOrCreateConversation:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get user's conversations
export const getUserConversations = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const conversations = await prisma.conversation.findMany({
      where: {
        participants: {
          some: {
            userId: user.id,
            isActive: true
          }
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
        },
        messages: {
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

    return res.status(200).json({
      message: "Conversations fetched successfully",
      data: conversations.map(conv => ({
        id: conv.id,
        participants: conv.participants.map(p => ({
          id: p.id,
          userId: p.userId,
          user: p.user,
          isActive: p.isActive,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt
        })),
        lastMessage: conv.messages[0] || null
      }))
    });
  } catch (error) {
    console.error('Error in getUserConversations:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get conversation messages
export const getConversationMessages = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(422).json({ message: "User not found" });
    }

    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;

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

    const skip = (Number(page) - 1) * Number(limit);

    const messages = await prisma.message.findMany({
      where: {
        conversationId,
        deletedAt: null, // Exclude soft-deleted messages
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

    const total = await prisma.message.count({
      where: {
        conversationId,
        deletedAt: null // Exclude soft-deleted messages
      }
    });

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

    // Check if file attachments are enabled for this conversation
    const attachmentsEnabled = await isFileAttachmentsEnabledForConversation(conversationId);
    if (!attachmentsEnabled) {
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

    // Soft delete the message
    await prisma.message.update({
      where: { id: messageId },
      data: { 
        deletedAt: new Date(),
        content: '[This message was deleted]' // Optional: replace content
      },
    });

    return res.status(200).json({
      message: "Direct message deleted successfully",
    });
  } catch (error) {
    console.error('Error in deleteDirectMessage:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
}; 