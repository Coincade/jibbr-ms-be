import prisma from '../config/database.js';
import { conversationIdFromRoom } from '../utils/room-id.js';

export const startHuddleSessionRecord = async (
  roomId: string,
  startedById: string,
  mediasoupSessionId: string
): Promise<string | undefined> => {
  try {
    // Idempotent under concurrent first joins (partial unique index on open roomId).
    const existing = await prisma.huddleSession.findFirst({
      where: { roomId, endedAt: null },
      select: { id: true },
    });
    if (existing) return existing.id;

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
  } catch (error: any) {
    // Unique violation from concurrent create — return the winner.
    if (error?.code === 'P2002') {
      const existing = await prisma.huddleSession.findFirst({
        where: { roomId, endedAt: null },
        select: { id: true },
      });
      if (existing) return existing.id;
    }
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
  userId: string,
  limit = 20
) => {
  // Membership-scoped: never expose private-channel or DM sessions to non-members.
  const [channelMemberships, conversationMemberships] = await Promise.all([
    prisma.channelMember.findMany({
      where: {
        userId,
        isActive: true,
        channel: {
          deletedAt: null,
          OR: [
            { workspaceId },
            {
              workspaceId: { not: workspaceId },
              OR: [
                {
                  collaboration: {
                    status: 'ACTIVE',
                    OR: [{ workspaceAId: workspaceId }, { workspaceBId: workspaceId }],
                  },
                },
                {
                  group: {
                    status: 'ACTIVE',
                    memberships: { some: { workspaceId, status: 'ACTIVE' } },
                  },
                },
              ],
            },
          ],
        },
      },
      select: { channelId: true },
    }),
    prisma.conversationParticipant.findMany({
      where: { userId, isActive: true, conversation: { workspaceId } },
      select: { conversationId: true },
    }),
  ]);

  const channelIds = channelMemberships.map((m) => m.channelId);
  const conversationIds = conversationMemberships.map((m) => m.conversationId);

  if (channelIds.length === 0 && conversationIds.length === 0) {
    return [];
  }

  return prisma.huddleSession.findMany({
    where: {
      OR: [
        ...(channelIds.length ? [{ channelId: { in: channelIds } }] : []),
        ...(conversationIds.length ? [{ conversationId: { in: conversationIds } }] : []),
      ],
    },
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
