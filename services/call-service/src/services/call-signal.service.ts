import { conversationIdFromRoom, isConversationRoom } from '../utils/room-id.js';

type CallSignalPayload = Record<string, unknown>;

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 200;

type SignalMetrics = {
  attempts: number;
  successes: number;
  failures: number;
  skippedNoConfig: number;
};

const metrics: SignalMetrics = {
  attempts: 0,
  successes: 0,
  failures: 0,
  skippedNoConfig: 0,
};

let missingConfigWarned = false;

export const getCallSignalMetrics = (): SignalMetrics => ({ ...metrics });

const getInternalSocketUrl = (): string | undefined => {
  const raw =
    process.env.SOCKET_SERVICE_INTERNAL_URL ||
    process.env.SOCKET_SERVICE_URL ||
    'http://localhost:3004';
  return raw.replace(/\/$/, '');
};

const getInternalSecret = (): string | undefined =>
  process.env.INTERNAL_SERVICE_SECRET?.trim() || undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const requireConfig = (): { baseUrl: string; secret: string } | null => {
  const baseUrl = getInternalSocketUrl();
  const secret = getInternalSecret();
  if (!baseUrl || !secret) {
    metrics.skippedNoConfig += 1;
    if (!missingConfigWarned) {
      missingConfigWarned = true;
      console.error(
        '[call-signal] INTERNAL_SERVICE_SECRET or SOCKET_SERVICE_INTERNAL_URL unset — huddle presence/producer signals will be dropped'
      );
    }
    return null;
  }
  return { baseUrl, secret };
};

const postWithRetry = async (
  path: string,
  body: Record<string, unknown>,
  label: string
): Promise<boolean> => {
  const config = requireConfig();
  if (!config) return false;

  metrics.attempts += 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${config.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': config.secret,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        metrics.successes += 1;
        return true;
      }
      const text = await res.text().catch(() => '');
      lastError = new Error(`HTTP ${res.status}: ${text}`);
      console.warn(
        `[call-signal] ${label} failed (attempt ${attempt}/${MAX_RETRIES}):`,
        res.status,
        text
      );
    } catch (error) {
      lastError = error;
      console.warn(
        `[call-signal] ${label} error (attempt ${attempt}/${MAX_RETRIES}):`,
        error
      );
    }

    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }

  metrics.failures += 1;
  console.error(`[call-signal] ${label} exhausted retries:`, lastError);
  return false;
};

/**
 * Notify socket-service to broadcast a huddle event to channel or conversation room.
 * Retries with exponential backoff; logs loudly when config is missing.
 */
export const emitCallRoomSignal = async (
  roomId: string,
  event: string,
  data: CallSignalPayload
): Promise<void> => {
  const conversationId = conversationIdFromRoom(roomId);
  const channelId = conversationId ? undefined : roomId;

  await postWithRetry(
    '/internal/call/broadcast',
    {
      channelId,
      conversationId: conversationId ?? undefined,
      event,
      data,
    },
    `broadcast ${event}`
  );
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
        : typeof data.channelId === 'string'
          ? data.channelId
          : undefined;

  // Direct Jabbr: discovery + state patches only to conversation participants.
  if (roomId && isConversationRoom(roomId)) {
    await emitCallRoomSignal(roomId, 'workspace_huddle_updated', {
      workspaceId,
      ...data,
    });
    return;
  }

  // Channel Jabbr: socket-service fans out only to channel members (not whole workspace).
  const channelId =
    typeof data.channelId === 'string'
      ? data.channelId
      : roomId && !isConversationRoom(roomId)
        ? roomId
        : undefined;

  await postWithRetry(
    '/internal/call/broadcast-workspace',
    {
      workspaceId,
      event: 'workspace_huddle_updated',
      data: { workspaceId, channelId, ...data },
    },
    'broadcast-workspace'
  );
};

export const emitChatMessage = async (
  roomId: string,
  message: CallSignalPayload
): Promise<void> => {
  const conversationId = conversationIdFromRoom(roomId);
  const channelId = conversationId ? undefined : roomId;

  await postWithRetry(
    '/internal/call/broadcast-message',
    {
      channelId,
      conversationId: conversationId ?? undefined,
      message,
    },
    'broadcast-message'
  );
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
