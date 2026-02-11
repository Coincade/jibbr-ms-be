import { Server as SocketIOServer } from 'socket.io';
import { createStreamRedisClient } from '../config/redis.js';
import {
  STREAMS,
  STREAMS_GROUP,
  STREAMS_CONSUMER,
  STREAMS_DEDUPE_TTL_SECONDS,
  STREAMS_CLAIM_IDLE_MS,
  STREAMS_READ_COUNT,
  STREAMS_BLOCK_MS,
} from '../config/streams.js';

type StreamMessage = {
  id: string;
  message: Record<string, string>;
};

type StreamEvent = {
  eventId: string;
  type: string;
  data: Record<string, any>;
  timestamp: string;
  source?: string;
};

let ioInstance: SocketIOServer | null = null;
type StreamRedisClient = Awaited<ReturnType<typeof createStreamRedisClient>>;
let streamClientPromise: Promise<StreamRedisClient> | null = null;
let isRunning = false;

const getStreamClient = async (): Promise<StreamRedisClient> => {
  if (!streamClientPromise) {
    streamClientPromise = createStreamRedisClient();
  }
  return streamClientPromise;
};

const ensureGroup = async (client: StreamRedisClient, stream: string) => {
  try {
    await client.xGroupCreate(stream, STREAMS_GROUP, '0', { MKSTREAM: true });
    console.log(`[Streams] Created consumer group ${STREAMS_GROUP} for ${stream}`);
  } catch (error: any) {
    if (String(error?.message || '').includes('BUSYGROUP')) {
      return;
    }
    throw error;
  }
};

const parseStreamEvent = (entry: StreamMessage): StreamEvent => {
  const rawPayload = entry.message.payload;
  let event: Partial<StreamEvent> = {};

  if (rawPayload) {
    try {
      event = JSON.parse(rawPayload);
    } catch (error) {
      console.error('[Streams] Failed to parse payload JSON:', error);
    }
  }

  const eventId = entry.message.eventId || event.eventId || entry.id;
  const type = entry.message.type || event.type || 'unknown';
  const timestamp = entry.message.timestamp || event.timestamp || new Date().toISOString();

  return {
    eventId,
    type,
    timestamp,
    data: (event.data as Record<string, any>) || {},
    source: event.source,
  };
};

const shouldProcessEvent = async (
  client: StreamRedisClient,
  eventId: string
): Promise<boolean> => {
  const dedupeKey = `dedupe:${eventId}`;
  const result = await client.set(dedupeKey, '1', {
    NX: true,
    EX: STREAMS_DEDUPE_TTL_SECONDS,
  });
  return result === 'OK';
};

const processStreamMessage = async (
  client: StreamRedisClient,
  streamName: string,
  entry: StreamMessage
) => {
  const event = parseStreamEvent(entry);

  const isNew = await shouldProcessEvent(client, event.eventId);
  if (!isNew) {
    await client.xAck(streamName, STREAMS_GROUP, entry.id);
    console.log('[Streams] Duplicate event skipped:', event.eventId);
    return;
  }

  switch (streamName) {
    case STREAMS.MESSAGES:
      await handleMessageEvent(event);
      break;
    case STREAMS.NOTIFICATIONS:
      await handleNotificationEvent(event);
      break;
    case STREAMS.USER_EVENTS:
      await handleUserEvent(event);
      break;
    case STREAMS.WORKSPACE_EVENTS:
      await handleWorkspaceEvent(event);
      break;
    case STREAMS.CHANNEL_EVENTS:
      await handleChannelEvent(event);
      break;
    default:
      console.warn('[Streams] Unknown stream:', streamName);
  }

  await client.xAck(streamName, STREAMS_GROUP, entry.id);
};

const claimStaleMessages = async (
  client: StreamRedisClient,
  streamName: string
) => {
  try {
    const claimResult = (await client.xAutoClaim(
      streamName,
      STREAMS_GROUP,
      STREAMS_CONSUMER,
      STREAMS_CLAIM_IDLE_MS,
      '0-0',
      { COUNT: STREAMS_READ_COUNT }
    )) as unknown as { nextId: string; messages: StreamMessage[] };

    if (!claimResult?.messages?.length) {
      return;
    }

    for (const entry of claimResult.messages) {
      try {
        await processStreamMessage(client, streamName, entry);
      } catch (error) {
        console.error('[Streams] Failed to process claimed message:', error);
      }
    }
  } catch (error) {
    console.error('[Streams] Failed to claim stale messages:', error);
  }
};

/**
 * Initialize Streams consumer with Socket.IO instance
 */
export function setSocketIOInstance(io: SocketIOServer) {
  ioInstance = io;
}

/**
 * Start consuming messages from Valkey Streams and broadcast to WebSocket clients
 */
export async function startStreamsConsumer() {
  if (!ioInstance) {
    throw new Error('Socket.IO instance not set. Call setSocketIOInstance() first.');
  }

  if (isRunning) {
    return;
  }

  isRunning = true;
  const client = await getStreamClient();

  const streamNames = Object.values(STREAMS);
  for (const streamName of streamNames) {
    await ensureGroup(client, streamName);
  }

  const claimInterval = setInterval(() => {
    if (!isRunning) return;
    streamNames.forEach((streamName) => {
      claimStaleMessages(client, streamName).catch(() => undefined);
    });
  }, Math.max(STREAMS_CLAIM_IDLE_MS, 10000));

  const streamKeys = streamNames.map((streamName) => ({
    key: streamName,
    id: '>',
  }));

  while (isRunning) {
    try {
      const response = await client.xReadGroup(
        STREAMS_GROUP,
        STREAMS_CONSUMER,
        streamKeys,
        { COUNT: STREAMS_READ_COUNT, BLOCK: STREAMS_BLOCK_MS }
      );

      if (!response) {
        continue;
      }

      for (const streamResponse of response) {
        for (const entry of streamResponse.messages) {
          try {
            await processStreamMessage(client, streamResponse.name, entry);
          } catch (error) {
            console.error('[Streams] Failed to process message:', error);
          }
        }
      }
    } catch (error) {
      console.error('[Streams] Read loop error:', error);
    }
  }

  clearInterval(claimInterval);
}

/**
 * Handle message events from Streams
 */
async function handleMessageEvent(event: StreamEvent) {
  if (!ioInstance) return;

  const { type, data } = event;

  switch (type) {
    case 'message.created':
      if (data.channelId) {
        ioInstance.to(String(data.channelId)).emit('new_message', {
          message: data,
          timestamp: event.timestamp,
        });
        console.log(`[Streams] Broadcasted message.created to channel: ${data.channelId}`);
      } else if (data.conversationId) {
        ioInstance.to(`conversation:${data.conversationId}`).emit('new_direct_message', {
          message: data,
          timestamp: event.timestamp,
        });
        console.log(`[Streams] Broadcasted message.created to conversation: ${data.conversationId}`);
      }
      break;

    case 'message.updated':
      if (data.channelId) {
        ioInstance.to(String(data.channelId)).emit('message_edited', {
          messageId: data.id,
          content: data.content,
          updatedAt: data.updatedAt,
          timestamp: event.timestamp,
        });
        console.log(`[Streams] Broadcasted message.updated to channel: ${data.channelId}`);
      } else if (data.conversationId) {
        ioInstance.to(`conversation:${data.conversationId}`).emit('direct_message_edited', {
          messageId: data.id,
          content: data.content,
          updatedAt: data.updatedAt,
          timestamp: event.timestamp,
        });
        console.log(`[Streams] Broadcasted message.updated to conversation: ${data.conversationId}`);
      }
      break;

    case 'message.deleted':
      if (data.channelId) {
        ioInstance.to(String(data.channelId)).emit('message_deleted', {
          messageId: data.id,
          deletedAt: data.deletedAt,
          timestamp: event.timestamp,
        });
        console.log(`[Streams] Broadcasted message.deleted to channel: ${data.channelId}`);
      } else if (data.conversationId) {
        ioInstance.to(`conversation:${data.conversationId}`).emit('direct_message_deleted', {
          messageId: data.id,
          deletedAt: data.deletedAt,
          timestamp: event.timestamp,
        });
        console.log(`[Streams] Broadcasted message.deleted to conversation: ${data.conversationId}`);
      }
      break;

    default:
      console.warn('[Streams] Unknown message event type:', type);
  }
}

/**
 * Handle notification events from Streams
 */
async function handleNotificationEvent(event: StreamEvent) {
  if (!ioInstance) return;

  const { type, data } = event;

  switch (type) {
    case 'notification.created':
      if (data.userId) {
        ioInstance.to(`user:${data.userId}`).emit('notification', {
          notification: data,
          timestamp: event.timestamp,
        });
        console.log(`[Streams] Sent notification to user: ${data.userId}`);
      }
      break;
    default:
      console.warn('[Streams] Unknown notification event type:', type);
  }
}

/**
 * Handle user events from Streams
 */
async function handleUserEvent(event: StreamEvent) {
  if (!ioInstance) return;

  const { type, data } = event;

  switch (type) {
    case 'user.created':
      ioInstance.emit('user_created', {
        user: data,
        timestamp: event.timestamp,
      });
      console.log('[Streams] Broadcasted user.created event');
      break;

    case 'user.updated':
      ioInstance.emit('user_updated', {
        user: data,
        timestamp: event.timestamp,
      });
      console.log('[Streams] Broadcasted user.updated event');
      break;

    case 'user.deleted':
      ioInstance.emit('user_deleted', {
        userId: data.id,
        timestamp: event.timestamp,
      });
      console.log('[Streams] Broadcasted user.deleted event');
      break;

    case 'user.status_changed':
      ioInstance.emit('user_set_status_change', {
        userId: data.userId,
        status: data.status,
        customMessage: data.customMessage ?? '',
      });
      console.log('[Streams] Broadcasted user.status_changed to user_set_status_change');
      break;

    default:
      console.warn('[Streams] Unknown user event type:', type);
  }
}

/**
 * Handle workspace events from Streams
 */
async function handleWorkspaceEvent(event: StreamEvent) {
  if (!ioInstance) return;

  const { type, data } = event;

  switch (type) {
    case 'workspace.created':
      if (data.id) {
        ioInstance.to(`workspace:${data.id}`).emit('workspace_created', {
          workspace: data,
          timestamp: event.timestamp,
        });
        console.log(`[Streams] Broadcasted workspace.created to workspace: ${data.id}`);
      }
      break;

    case 'workspace.updated':
      if (data.id) {
        ioInstance.to(`workspace:${data.id}`).emit('workspace_updated', {
          workspace: data,
          timestamp: event.timestamp,
        });
        console.log(`[Streams] Broadcasted workspace.updated to workspace: ${data.id}`);
      }
      break;

    case 'workspace.deleted':
      if (data.id) {
        ioInstance.to(`workspace:${data.id}`).emit('workspace_deleted', {
          workspaceId: data.id,
          timestamp: event.timestamp,
        });
        console.log(`[Streams] Broadcasted workspace.deleted to workspace: ${data.id}`);
      }
      break;

    default:
      console.warn('[Streams] Unknown workspace event type:', type);
  }
}

/**
 * Handle channel events from Streams
 */
async function handleChannelEvent(event: StreamEvent) {
  if (!ioInstance) return;

  const { type, data } = event;

  switch (type) {
    case 'channel.created':
      if (data.workspaceId) {
        ioInstance.to(`workspace:${data.workspaceId}`).emit('channel_created', {
          channel: data,
          timestamp: event.timestamp,
        });
        console.log(`[Streams] Broadcasted channel.created to workspace: ${data.workspaceId}`);
      }
      break;

    case 'channel.updated':
      if (data.id) {
        ioInstance.to(String(data.id)).emit('channel_updated', {
          channel: data,
          timestamp: event.timestamp,
        });
        console.log(`[Streams] Broadcasted channel.updated to channel: ${data.id}`);
      }
      break;

    case 'channel.deleted':
      if (data.id) {
        ioInstance.to(String(data.id)).emit('channel_deleted', {
          channelId: data.id,
          timestamp: event.timestamp,
        });
        console.log(`[Streams] Broadcasted channel.deleted to channel: ${data.id}`);
      }
      break;

    default:
      console.warn('[Streams] Unknown channel event type:', type);
  }
}

// Graceful shutdown
const shutdown = async () => {
  isRunning = false;
  if (streamClientPromise) {
    try {
      const client = await streamClientPromise;
      await client.quit();
      console.log('[Streams] Client disconnected');
    } catch (error) {
      console.error('[Streams] Failed to disconnect client:', error);
    }
  }
};

process.on('SIGTERM', () => shutdown().catch(() => undefined));
process.on('SIGINT', () => shutdown().catch(() => undefined));
