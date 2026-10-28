import {
  canUserReadChannelHistory,
  isCollaborationDmMutationAllowedForConversation,
} from '@jibbr/database';
import prisma from '../config/database.js';
import { conversationIdFromRoom } from '../utils/room-id.js';

export const assertChannelMember = async (userId: string, channelId: string): Promise<void> => {
  const canRead = await canUserReadChannelHistory(prisma, channelId, userId);
  if (!canRead) {
    throw new Error('You are not a member of this channel');
  }
};

export const assertConversationParticipant = async (
  userId: string,
  conversationId: string
): Promise<void> => {
  const [participant, conversation] = await Promise.all([
    prisma.conversationParticipant.findFirst({
      where: { conversationId, userId, isActive: true },
      select: { id: true },
    }),
    prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { workspaceId: true, collaborationId: true, groupId: true },
    }),
  ]);

  if (!participant || !conversation) {
    throw new Error('You are not a participant in this conversation');
  }

  if (!conversation.collaborationId && !conversation.groupId) {
    return;
  }

  const dmAllowed = await isCollaborationDmMutationAllowedForConversation(prisma, conversationId);
  if (dmAllowed) return;

  const hostMember = await prisma.member.findFirst({
    where: { userId, workspaceId: conversation.workspaceId, isActive: true },
    select: { id: true },
  });
  if (!hostMember) {
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
