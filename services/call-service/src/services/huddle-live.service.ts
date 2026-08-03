import prisma from '../config/database.js';
import { getActiveRoomIds, getRoomSnapshot } from '../mediasoup/rooms.js';
import { conversationIdFromRoom, isConversationRoom } from '../utils/room-id.js';

export type LiveHuddleItem = {
  roomId: string;
  channelId: string | null;
  conversationId: string | null;
  channelName: string | null;
  participantCount: number;
  hostUserId: string;
  startedAt: string;
};

export const assertWorkspaceMember = async (
  userId: string,
  workspaceId: string
): Promise<void> => {
  const member = await prisma.member.findFirst({
    where: { workspaceId, userId, isActive: true },
    select: { id: true },
  });
  if (!member) {
    throw new Error('You are not a member of this workspace');
  }
};

/**
 * Channels the user may see Jabbr presence for in this workspace context —
 * mirrors messaging-service channel list (local + active collab/group shared channels).
 * Never includes channels the user is not a member of.
 */
const listVisibleChannelMemberships = async (
  workspaceId: string,
  userId: string
): Promise<Array<{ channelId: string; name: string | null }>> => {
  const channels = await prisma.channel.findMany({
    where: {
      deletedAt: null,
      isBridgeChannel: false,
      members: {
        some: {
          userId,
          isActive: true,
        },
      },
      OR: [
        {
          AND: [
            { workspaceId },
            {
              OR: [
                { collaborationId: null, groupId: null },
                { collaboration: { status: 'ACTIVE' } },
                { group: { status: 'ACTIVE' } },
              ],
            },
          ],
        },
        {
          AND: [
            { workspaceId: { not: workspaceId } },
            {
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
                    memberships: {
                      some: {
                        workspaceId,
                        status: 'ACTIVE',
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    select: { id: true, name: true },
  });
  return channels.map((c) => ({ channelId: c.id, name: c.name }));
};

export const listLiveHuddlesForWorkspace = async (
  workspaceId: string,
  userId: string
): Promise<LiveHuddleItem[]> => {
  await assertWorkspaceMember(userId, workspaceId);

  const [channelMemberships, conversationMemberships] = await Promise.all([
    listVisibleChannelMemberships(workspaceId, userId),
    prisma.conversationParticipant.findMany({
      where: { userId, isActive: true, conversation: { workspaceId } },
      select: { conversationId: true },
    }),
  ]);

  const allowedRoomIds = new Set<string>([
    ...channelMemberships.map((m) => m.channelId),
    ...conversationMemberships.map((m) => `conv:${m.conversationId}`),
  ]);

  const channelNameById = new Map(
    channelMemberships.map((c) => [c.channelId, c.name] as const)
  );

  const items: LiveHuddleItem[] = [];

  for (const roomId of getActiveRoomIds()) {
    if (!allowedRoomIds.has(roomId)) continue;
    const snapshot = getRoomSnapshot(roomId);
    if (!snapshot || snapshot.participantCount <= 0) continue;

    const conversationId = conversationIdFromRoom(roomId);
    const channelId = conversationId ? null : roomId;

    items.push({
      roomId,
      channelId,
      conversationId,
      channelName: channelId ? (channelNameById.get(channelId) ?? null) : null,
      participantCount: snapshot.participantCount,
      hostUserId: snapshot.hostUserId,
      startedAt: snapshot.startedAt,
    });
  }

  return items.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
};

export const resolveWorkspaceIdForRoom = async (roomId: string): Promise<string | null> => {
  const conversationId = conversationIdFromRoom(roomId);
  if (conversationId) {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { workspaceId: true },
    });
    return conv?.workspaceId ?? null;
  }
  const ch = await prisma.channel.findUnique({
    where: { id: roomId },
    select: { workspaceId: true },
  });
  return ch?.workspaceId ?? null;
};

export const buildWorkspaceHuddlePayload = (
  workspaceId: string,
  roomId: string,
  snapshot: NonNullable<ReturnType<typeof getRoomSnapshot>>,
  extras?: { channelName?: string | null; startedByName?: string }
) => {
  const conversationId = conversationIdFromRoom(roomId);
  const channelId = conversationId ? null : roomId;
  return {
    workspaceId,
    roomId,
    channelId: channelId ?? undefined,
    conversationId: conversationId ?? undefined,
    active: true,
    participantCount: snapshot.participantCount,
    hostUserId: snapshot.hostUserId,
    startedAt: snapshot.startedAt,
    channelName: extras?.channelName ?? undefined,
    startedByName: extras?.startedByName,
  };
};

export const buildWorkspaceHuddleInactivePayload = (
  workspaceId: string,
  roomId: string
) => {
  const conversationId = conversationIdFromRoom(roomId);
  const channelId = isConversationRoom(roomId) ? undefined : roomId;
  return {
    workspaceId,
    roomId,
    channelId,
    conversationId: conversationId ?? undefined,
    active: false,
  };
};
