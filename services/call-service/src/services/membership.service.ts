import prisma from '../config/database.js';
import { conversationIdFromRoom, isConversationRoom } from '../utils/room-id.js';

export const assertChannelMember = async (userId: string, channelId: string): Promise<void> => {
  const member = await prisma.channelMember.findFirst({
    where: { channelId, userId, isActive: true },
    select: { id: true },
  });

  if (!member) {
    throw new Error('You are not a member of this channel');
  }
};

export const assertConversationParticipant = async (
  userId: string,
  conversationId: string
): Promise<void> => {
  const participant = await prisma.conversationParticipant.findFirst({
    where: { conversationId, userId, isActive: true },
    select: { id: true },
  });

  if (!participant) {
    throw new Error('You are not a participant in this conversation');
  }
};

export const assertRoomMember = async (userId: string, roomId: string): Promise<void> => {
  const conversationId = conversationIdFromRoom(roomId);
  if (conversationId) {
    await assertConversationParticipant(userId, conversationId);
    return;
  }
  await assertChannelMember(userId, roomId);
};
