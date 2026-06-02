import prisma from '../config/database.js';
import { isConversationRoom, conversationIdFromRoom } from '../utils/room-id.js';

export const startHuddleSessionRecord = async (
  roomId: string,
  startedById: string,
  mediasoupSessionId: string
): Promise<string | undefined> => {
  try {
    const conversationId = conversationIdFromRoom(roomId);
    const channelId = conversationId ? null : roomId;

    let workspaceId: string | null = null;
    if (channelId) {
      const ch = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { workspaceId: true },
      });
      workspaceId = ch?.workspaceId ?? null;
    } else if (conversationId) {
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { workspaceId: true },
      });
      workspaceId = conv?.workspaceId ?? null;
    }

    const row = await prisma.huddleSession.create({
      data: {
        roomId,
        channelId,
        conversationId,
        workspaceId,
        startedById,
        mediasoupSessionId,
      },
    });
    return row.id;
  } catch (error) {
    console.warn('[call-service] Failed to record huddle session start:', error);
    return undefined;
  }
};

export const endHuddleSessionRecord = async (
  roomId: string,
  participantCount: number
): Promise<number> => {
  try {
    const result = await prisma.huddleSession.updateMany({
      where: { roomId, endedAt: null },
      data: {
        endedAt: new Date(),
        peakParticipantCount: participantCount,
      },
    });
    return result.count;
  } catch (error) {
    console.warn('[call-service] Failed to record huddle session end:', error);
    return 0;
  }
};

export const listChannelHuddleHistory = async (channelId: string, limit = 20) => {
  return prisma.huddleSession.findMany({
    where: { channelId },
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      roomId: true,
      channelId: true,
      conversationId: true,
      startedById: true,
      startedAt: true,
      endedAt: true,
      peakParticipantCount: true,
      startedBy: { select: { id: true, name: true, image: true } },
      channel: { select: { id: true, name: true } },
    },
  });
};

export const listRecentHuddles = async (
  workspaceId: string,
  limit = 20
) => {
  return prisma.huddleSession.findMany({
    where: { workspaceId },
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      roomId: true,
      channelId: true,
      conversationId: true,
      startedById: true,
      startedAt: true,
      endedAt: true,
      peakParticipantCount: true,
      startedBy: { select: { id: true, name: true, image: true } },
      channel: { select: { id: true, name: true } },
    },
  });
};
