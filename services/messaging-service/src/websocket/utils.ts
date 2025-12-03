import { Socket } from 'socket.io';
import { JwtPayload } from 'jsonwebtoken';
import jwt from 'jsonwebtoken';
import { ChannelClientsMap, ConversationClientsMap } from './types.js';

// Socket.IO client with user info
export interface SocketWithUser extends Socket {
  data: {
    user?: JwtPayload & { id: string; name?: string; image?: string };
  };
}

/**
 * Authenticate socket connection using JWT token
 */
export const authenticateSocket = (token: string): JwtPayload & { id: string; name?: string; image?: string } | null => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload & { id: string; name?: string; image?: string };
    return decoded;
  } catch (error) {
    console.error('Socket authentication failed:', error);
    return null;
  }
};

/**
 * Add client to channel room
 */
export const addClientToChannel = (socket: Socket, channelId: string, channelClients: ChannelClientsMap): void => {
  socket.join(channelId);
  
  if (!channelClients.has(channelId)) {
    channelClients.set(channelId, new Set());
  }
  channelClients.get(channelId)!.add(socket);
  
  console.log(`Client ${socket.id} added to channel ${channelId}`);
};

/**
 * Add client to conversation room
 */
export const addClientToConversation = (socket: Socket, conversationId: string, conversationClients: ConversationClientsMap): void => {
  socket.join(conversationId);
  
  if (!conversationClients.has(conversationId)) {
    conversationClients.set(conversationId, new Set());
  }
  conversationClients.get(conversationId)!.add(socket);
  
  console.log(`Client ${socket.id} added to conversation ${conversationId}`);
};

/**
 * Remove client from all channels
 */
export const removeClientFromAllChannels = (socket: Socket, channelClients: ChannelClientsMap): void => {
  for (const [channelId, clients] of channelClients.entries()) {
    if (clients.has(socket)) {
      clients.delete(socket);
      socket.leave(channelId);
      console.log(`Client ${socket.id} removed from channel ${channelId}`);
    }
  }
};

/**
 * Remove client from all conversations
 */
export const removeClientFromAllConversations = (socket: Socket, conversationClients: ConversationClientsMap): void => {
  for (const [conversationId, clients] of conversationClients.entries()) {
    if (clients.has(socket)) {
      clients.delete(socket);
      socket.leave(conversationId);
      console.log(`Client ${socket.id} removed from conversation ${conversationId}`);
    }
  }
};

/**
 * Broadcast message to channel
 */
export const broadcastToChannel = (io: any, channelId: string, event: string, data: any): void => {
  io.to(channelId).emit(event, data);
};

/**
 * Broadcast message to conversation
 */
export const broadcastToConversation = (io: any, conversationId: string, event: string, data: any): void => {
  io.to(conversationId).emit(event, data);
};

/**
 * Send message to specific user
 */
export const sendToUser = (io: any, userId: string, event: string, data: any): void => {
  io.to(`user_${userId}`).emit(event, data);
};

/**
 * Validate channel membership
 */
export const validateChannelMembership = async (userId: string, channelId: string): Promise<boolean> => {
  try {
    const { default: prisma } = await import('../config/database.js');
    
    const channelMember = await prisma.channelMember.findFirst({
      where: {
        channelId,
        userId,
        isActive: true,
      },
    });
    
    return !!channelMember;
  } catch (error) {
    console.error('Error validating channel membership:', error);
    return false;
  }
};

/**
 * Validate conversation participation
 */
export const validateConversationParticipation = async (userId: string, conversationId: string): Promise<boolean> => {
  try {
    const { default: prisma } = await import('../config/database.js');
    
    const participant = await prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        isActive: true,
      },
    });
    
    return !!participant;
  } catch (error) {
    console.error('Error validating conversation participation:', error);
    return false;
  }
};

/**
 * Get or create conversation between two users
 */
export const getOrCreateConversation = async (userId1: string, userId2: string): Promise<string> => {
  try {
    const { default: prisma } = await import('../config/database.js');
    
    // Check if conversation already exists
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        participants: {
          every: {
            userId: {
              in: [userId1, userId2]
            },
            isActive: true
          }
        }
      },
      include: {
        participants: true
      }
    });
    
    if (existingConversation && existingConversation.participants.length === 2) {
      return existingConversation.id;
    }
    
    // Create new conversation
    const conversation = await prisma.conversation.create({
      data: {
        participants: {
          create: [
            { userId: userId1 },
            { userId: userId2 }
          ]
        }
      }
    });
    
    return conversation.id;
  } catch (error) {
    console.error('Error getting or creating conversation:', error);
    throw error;
  }
};

/**
 * Get user info
 */
export const getUserInfo = async (userId: string) => {
  try {
    const { default: prisma } = await import('../config/database.js');
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
      },
    });
    
    return user;
  } catch (error) {
    console.error('Error getting user info:', error);
    return null;
  }
};

/**
 * Get conversation participants
 */
export const getConversationParticipants = async (conversationId: string): Promise<string[]> => {
  try {
    const { default: prisma } = await import('../config/database.js');
    
    const participants = await prisma.conversationParticipant.findMany({
      where: {
        conversationId,
        isActive: true,
      },
      select: {
        userId: true,
      },
    });
    
    return participants.map(p => p.userId);
  } catch (error) {
    console.error('Error getting conversation participants:', error);
    return [];
  }
}; 