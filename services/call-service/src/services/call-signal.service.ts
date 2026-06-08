import { conversationIdFromRoom, isConversationRoom } from '../utils/room-id.js';

type CallSignalPayload = Record<string, unknown>;

const getInternalSocketUrl = (): string | undefined => {
  const raw =
    process.env.SOCKET_SERVICE_INTERNAL_URL ||
    process.env.SOCKET_SERVICE_URL ||
    'http://localhost:3004';
  return raw.replace(/\/$/, '');
};

const getInternalSecret = (): string | undefined =>
  process.env.INTERNAL_SERVICE_SECRET?.trim() || undefined;

/**
 * Notify socket-service to broadcast a huddle event to channel or conversation room.
 * No-op when INTERNAL_SERVICE_SECRET or URL is unset (dev without socket HTTP).
 */
export const emitCallRoomSignal = async (
  roomId: string,
  event: string,
  data: CallSignalPayload
): Promise<void> => {
  const baseUrl = getInternalSocketUrl();
  const secret = getInternalSecret();
  if (!baseUrl || !secret) return;

  const conversationId = conversationIdFromRoom(roomId);
  const channelId = conversationId ? undefined : roomId;

  try {
    const res = await fetch(`${baseUrl}/internal/call/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify({
        channelId,
        conversationId: conversationId ?? undefined,
        event,
        data,
      }),
    });
    if (!res.ok) {
      console.warn('[call-signal] broadcast failed:', res.status, await res.text());
    }
  } catch (error) {
    console.warn('[call-signal] broadcast error:', error);
  }
};

export const emitWorkspaceHuddleUpdate = async (
  workspaceId: string,
  data: CallSignalPayload
): Promise<void> => {
  const roomId =
    typeof data.roomId === 'string'
      ? data.roomId
      : typeof data.conversationId === 'string'
        ? `conv:${data.conversationId}`
        : undefined;

  // Direct Jabbr: discovery + state patches only to conversation participants.
  if (roomId && isConversationRoom(roomId)) {
    await emitCallRoomSignal(roomId, 'workspace_huddle_updated', {
      workspaceId,
      ...data,
    });
    return;
  }

  const baseUrl = getInternalSocketUrl();
  const secret = getInternalSecret();
  if (!baseUrl || !secret) return;

  try {
    const res = await fetch(`${baseUrl}/internal/call/broadcast-workspace`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify({
        workspaceId,
        event: 'workspace_huddle_updated',
        data: { workspaceId, ...data },
      }),
    });
    if (!res.ok) {
      console.warn('[call-signal] workspace broadcast failed:', res.status, await res.text());
    }
  } catch (error) {
    console.warn('[call-signal] workspace broadcast error:', error);
  }
};

export const emitChatMessage = async (
  roomId: string,
  message: CallSignalPayload
): Promise<void> => {
  const conversationId = conversationIdFromRoom(roomId);
  const channelId = conversationId ? undefined : roomId;

  const baseUrl = getInternalSocketUrl();
  const secret = getInternalSecret();
  if (!baseUrl || !secret) return;

  try {
    const res = await fetch(`${baseUrl}/internal/call/broadcast-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify({
        channelId,
        conversationId: conversationId ?? undefined,
        message,
      }),
    });
    if (!res.ok) {
      console.warn('[call-signal] message broadcast failed:', res.status, await res.text());
    }
  } catch (error) {
    console.warn('[call-signal] message broadcast error:', error);
  }
};

export const emitProducerClosed = async (
  roomId: string,
  userId: string,
  producerId: string,
  kind: 'audio' | 'video',
  source?: 'camera' | 'screen'
): Promise<void> => {
  const event = isConversationRoom(roomId)
    ? 'conversation_call_producer_closed'
    : 'channel_call_producer_closed';

  const conversationId = conversationIdFromRoom(roomId);
  const channelId = conversationId ? undefined : roomId;

  await emitCallRoomSignal(roomId, event, {
    channelId,
    conversationId: conversationId ?? undefined,
    producerId,
    userId,
    kind,
    source,
    timestamp: new Date().toISOString(),
  });
};
