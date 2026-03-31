import { Socket, ChannelClientsMap, AddReactionMessage, RemoveReactionMessage } from '../types.js';
import { validateChannelMembership } from '../utils.js';

/**
 * Handle add reaction event
 */
export const handleAddReaction = async (
  socket: Socket,
  data: AddReactionMessage,
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

    // Add reaction to database
    const { default: prisma } = await import('../../config/database.js');
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

    // Broadcast to channel using Socket.IO
    socket.to(data.channelId!).emit('reaction_added', {
      id: reaction.id,
      emoji: reaction.emoji,
      messageId: reaction.messageId,
      userId: reaction.userId,
      createdAt: reaction.createdAt.toISOString(),
      user: {
        id: reaction.user.id,
        name: reaction.user.name,
      },
    });

    // Ack to sender (used for offline queue + bounded retries)
    if ((data as any).clientOpId) {
      socket.emit('reaction_added_ack', {
        clientOpId: (data as any).clientOpId,
        messageId: reaction.messageId,
        emoji: reaction.emoji,
        userId: reaction.userId,
        reactionId: reaction.id,
      });
    }

  } catch (error) {
    console.error('Error handling add reaction:', error);
    socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to add reaction' });
  }
};

/**
 * Handle remove reaction event
 */
export const handleRemoveReaction = async (
  socket: Socket,
  data: RemoveReactionMessage,
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

    // Remove reaction from database
    const { default: prisma } = await import('../../config/database.js');
    const reaction = await prisma.reaction.findFirst({
      where: {
        messageId: data.messageId,
        userId: socket.data.user.id,
        emoji: data.emoji,
      },
    });

    if (!reaction) {
      throw new Error('Reaction not found');
    }

    await prisma.reaction.delete({
      where: { id: reaction.id },
    });

    // Broadcast to channel using Socket.IO
    socket.to(data.channelId!).emit('reaction_removed', {
      messageId: data.messageId,
      emoji: data.emoji,
      userId: socket.data.user.id,
    });

    if ((data as any).clientOpId) {
      socket.emit('reaction_removed_ack', {
        clientOpId: (data as any).clientOpId,
        messageId: data.messageId,
        emoji: data.emoji,
        userId: socket.data.user.id,
      });
    }

  } catch (error) {
    console.error('Error handling remove reaction:', error);
    socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to remove reaction' });
  }
};


