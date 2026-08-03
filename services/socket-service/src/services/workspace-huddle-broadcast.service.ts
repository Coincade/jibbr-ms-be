import prisma from '../config/database.js';
import { getWorkspaceRoomKey } from '../websocket/utils.js';
import type { IoLike } from '../websocket/ws-compat.js';

let ioRef: IoLike | null = null;

export const setWorkspaceHuddleIo = (io: IoLike): void => {
  ioRef = io;
};

/**
 * @deprecated Prefer broadcastChannelHuddleUpdate — workspace-wide fanout leaks
 * Jabbr presence to non-channel members (esp. collab / private / org channels).
 */
export const broadcastWorkspaceHuddleUpdate = (
  workspaceId: string,
  data: Record<string, unknown>
): void => {
  if (!ioRef) return;
  ioRef.to(getWorkspaceRoomKey(workspaceId)).emit('workspace_huddle_updated', {
    workspaceId,
    ...data,
  });
};

const workspaceIdByChannel = new Map<string, string>();
const workspaceIdByConversation = new Map<string, string>();

export const resolveWorkspaceIdForChannel = async (
  channelId: string
): Promise<string | null> => {
  const cached = workspaceIdByChannel.get(channelId);
  if (cached) return cached;
  const ch = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { workspaceId: true },
  });
  if (ch?.workspaceId) workspaceIdByChannel.set(channelId, ch.workspaceId);
  return ch?.workspaceId ?? null;
};

export const resolveWorkspaceIdForConversation = async (
  conversationId: string
): Promise<string | null> => {
  const cached = workspaceIdByConversation.get(conversationId);
  if (cached) return cached;
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { workspaceId: true },
  });
  if (conv?.workspaceId) workspaceIdByConversation.set(conversationId, conv.workspaceId);
  return conv?.workspaceId ?? null;
};

const listActiveChannelMemberIds = async (channelId: string): Promise<string[]> => {
  const members = await prisma.channelMember.findMany({
    where: { channelId, isActive: true },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
};

/**
 * Channel Jabbr updates go only to channel members (channel room + personal rooms).
 * Never the whole workspace — non-members in collab workspaces must not see/join.
 */
export const broadcastChannelHuddleUpdate = (
  channelId: string,
  workspaceId: string,
  data: Record<string, unknown>,
  memberUserIds?: string[]
): void => {
  if (!ioRef) return;
  const payload = {
    workspaceId,
    channelId,
    roomId: channelId,
    ...data,
  };

  // Anyone currently joined to the channel socket room
  ioRef.to(channelId).emit('workspace_huddle_updated', payload);

  // Online members who may not have join_channel'd yet (personal rooms)
  if (memberUserIds?.length) {
    for (const userId of memberUserIds) {
      ioRef.to(`user_${userId}`).emit('workspace_huddle_updated', payload);
    }
  }
};

export const fanoutWorkspaceHuddleFromChannel = async (
  channelId: string,
  patch: Record<string, unknown>
): Promise<void> => {
  const workspaceId = await resolveWorkspaceIdForChannel(channelId);
  if (!workspaceId) return;
  const memberUserIds = await listActiveChannelMemberIds(channelId);
  broadcastChannelHuddleUpdate(channelId, workspaceId, patch, memberUserIds);
};

/** DM Jabbr updates go only to conversation participants (conversation + personal rooms). */
export const broadcastConversationHuddleUpdate = (
  conversationId: string,
  workspaceId: string,
  data: Record<string, unknown>,
  memberUserIds?: string[]
): void => {
  if (!ioRef) return;
  const payload = {
    workspaceId,
    conversationId,
    roomId: `conv:${conversationId}`,
    ...data,
  };
  ioRef.to(conversationId).emit('workspace_huddle_updated', payload);
  if (memberUserIds?.length) {
    for (const userId of memberUserIds) {
      ioRef.to(`user_${userId}`).emit('workspace_huddle_updated', payload);
    }
  }
};

export const fanoutWorkspaceHuddleFromConversation = async (
  conversationId: string,
  patch: Record<string, unknown>
): Promise<void> => {
  const workspaceId = await resolveWorkspaceIdForConversation(conversationId);
  if (!workspaceId) return;
  const members = await prisma.conversationParticipant.findMany({
    where: { conversationId, isActive: true },
    select: { userId: true },
  });
  broadcastConversationHuddleUpdate(
    conversationId,
    workspaceId,
    patch,
    members.map((m) => m.userId)
  );
};
