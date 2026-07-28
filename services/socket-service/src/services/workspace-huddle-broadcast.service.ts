import prisma from '../config/database.js';
import { getWorkspaceRoomKey } from '../websocket/utils.js';
import type { IoLike } from '../websocket/ws-compat.js';

let ioRef: IoLike | null = null;

export const setWorkspaceHuddleIo = (io: IoLike): void => {
  ioRef = io;
};

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

export const fanoutWorkspaceHuddleFromChannel = async (
  channelId: string,
  patch: Record<string, unknown>
): Promise<void> => {
  const workspaceId = await resolveWorkspaceIdForChannel(channelId);
  if (!workspaceId) return;
  broadcastWorkspaceHuddleUpdate(workspaceId, {
    channelId,
    roomId: channelId,
    ...patch,
  });
};

/** DM Jabbr updates go only to conversation participants (not the whole workspace). */
export const broadcastConversationHuddleUpdate = (
  conversationId: string,
  workspaceId: string,
  data: Record<string, unknown>
): void => {
  if (!ioRef) return;
  ioRef.to(conversationId).emit('workspace_huddle_updated', {
    workspaceId,
    conversationId,
    roomId: `conv:${conversationId}`,
    ...data,
  });
};

export const fanoutWorkspaceHuddleFromConversation = async (
  conversationId: string,
  patch: Record<string, unknown>
): Promise<void> => {
  const workspaceId = await resolveWorkspaceIdForConversation(conversationId);
  if (!workspaceId) return;
  broadcastConversationHuddleUpdate(conversationId, workspaceId, patch);
};
