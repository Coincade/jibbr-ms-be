import { randomUUID } from 'crypto';
import type { RedisClientType } from 'redis';
import { createStreamRedisClient } from '../config/redis.js';
import { STREAMS } from '../config/streams.js';

type StreamEvent = {
  eventId: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
  source: string;
};

let streamClientPromise: Promise<RedisClientType> | null = null;

const getStreamClient = async (): Promise<RedisClientType> => {
  if (!streamClientPromise) {
    streamClientPromise = createStreamRedisClient();
  }
  return streamClientPromise;
};

const publishEvent = async (stream: string, event: StreamEvent): Promise<void> => {
  const client = await getStreamClient();
  await client.xAdd(stream, '*', {
    eventId: event.eventId,
    type: event.type,
    payload: JSON.stringify(event),
    timestamp: event.timestamp,
    source: event.source,
  });
};

/**
 * Publish message created event to Valkey Streams
 */
export async function publishMessageCreatedEvent(message: any) {
  try {
    const event: StreamEvent = {
      eventId: randomUUID(),
      type: 'message.created',
      data: {
        id: message.id,
        content: message.content,
        userId: message.userId,
        channelId: message.channelId || null,
        conversationId: message.conversationId || null,
        replyToId: message.replyToId || null,
        createdAt: message.createdAt?.toISOString() || new Date().toISOString(),
        attachments: message.attachments || [],
        reactions: message.reactions || [],
        user: message.user || null,
      },
      timestamp: new Date().toISOString(),
      source: 'messaging-service',
    };

    await publishEvent(STREAMS.MESSAGES, event);
    console.log('[Streams] Published message.created event:', message.id);
  } catch (error) {
    console.error('[Streams] Failed to publish message.created event:', error);
    // Don't throw - allow the request to succeed even if Streams fails
  }
}

/**
 * Publish message updated event to Valkey Streams
 */
export async function publishMessageUpdatedEvent(message: any) {
  try {
    const event: StreamEvent = {
      eventId: randomUUID(),
      type: 'message.updated',
      data: {
        id: message.id,
        content: message.content,
        userId: message.userId,
        channelId: message.channelId || null,
        conversationId: message.conversationId || null,
        updatedAt: message.updatedAt?.toISOString() || new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
      source: 'messaging-service',
    };

    await publishEvent(STREAMS.MESSAGES, event);
    console.log('[Streams] Published message.updated event:', message.id);
  } catch (error) {
    console.error('[Streams] Failed to publish message.updated event:', error);
    // Don't throw - allow the request to succeed even if Streams fails
  }
}

/**
 * Publish message deleted event to Valkey Streams
 */
export async function publishMessageDeletedEvent(message: any) {
  try {
    const event: StreamEvent = {
      eventId: randomUUID(),
      type: 'message.deleted',
      data: {
        id: message.id,
        channelId: message.channelId || null,
        conversationId: message.conversationId || null,
        deletedAt: message.deletedAt?.toISOString() || new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
      source: 'messaging-service',
    };

    await publishEvent(STREAMS.MESSAGES, event);
    console.log('[Streams] Published message.deleted event:', message.id);
  } catch (error) {
    console.error('[Streams] Failed to publish message.deleted event:', error);
    // Don't throw - allow the request to succeed even if Streams fails
  }
}
