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
    const currentUserId = socket.data.user.id;

    // Validate channel membership
    const isMember = await validateChannelMembership(currentUserId, data.channelId!);
    if (!isMember) {
      throw new Error('You are not a member of this channel');
    }

    // Add reaction to database
    const { default: prisma } = await import('../../config/database.js');
    const reaction = await prisma.reaction.create({
      data: {
        emoji: data.emoji,
        messageId: data.messageId,
        userId: currentUserId,
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
    // Idempotent replay: reaction may already exist from a previous successful attempt.
    const code = (error as any)?.code;
    if (code === 'P2002') {
      const currentUserId = socket.data.user?.id;
      if (!currentUserId) {
        console.error('Error handling add reaction:', error);
        socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to add reaction' });
        return;
      }
      const { default: prisma } = await import('../../config/database.js');
      const existing = await prisma.reaction.findFirst({
        where: {
          messageId: data.messageId,
          userId: currentUserId,
          emoji: data.emoji,
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
      if (existing) {
        if ((data as any).clientOpId) {
          socket.emit('reaction_added_ack', {
            clientOpId: (data as any).clientOpId,
            messageId: existing.messageId,
            emoji: existing.emoji,
            userId: existing.userId,
            reactionId: existing.id,
            noop: true,
          });
        }
        return;
      }
    }
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
    const currentUserId = socket.data.user.id;

    // Validate channel membership
    const isMember = await validateChannelMembership(currentUserId, data.channelId!);
    if (!isMember) {
      throw new Error('You are not a member of this channel');
    }

    // Remove reaction from database
    const { default: prisma } = await import('../../config/database.js');
    const reaction = await prisma.reaction.findFirst({
      where: {
        messageId: data.messageId,
        userId: currentUserId,
        emoji: data.emoji,
      },
    });

    if (!reaction) {
      if ((data as any).clientOpId) {
        socket.emit('reaction_removed_ack', {
          clientOpId: (data as any).clientOpId,
          messageId: data.messageId,
          emoji: data.emoji,
          userId: currentUserId,
          noop: true,
        });
        return;
      }
      throw new Error('Reaction not found');
    }

    await prisma.reaction.delete({
      where: { id: reaction.id },
    });

    // Broadcast to channel using Socket.IO
    socket.to(data.channelId!).emit('reaction_removed', {
      messageId: data.messageId,
      emoji: data.emoji,
      userId: currentUserId,
    });

    if ((data as any).clientOpId) {
      socket.emit('reaction_removed_ack', {
        clientOpId: (data as any).clientOpId,
        messageId: data.messageId,
        emoji: data.emoji,
        userId: currentUserId,
      });
    }

  } catch (error) {
    const code = (error as any)?.code;
    const msg = error instanceof Error ? error.message.toLowerCase() : '';
    const currentUserId = socket.data.user?.id;
    if ((code === 'P2025' || msg.includes('reaction not found')) && (data as any).clientOpId) {
      socket.emit('reaction_removed_ack', {
        clientOpId: (data as any).clientOpId,
        messageId: data.messageId,
        emoji: data.emoji,
        userId: currentUserId || '',
        noop: true,
      });
      return;
    }
    console.error('Error handling remove reaction:', error);
    socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to remove reaction' });
  }
};


