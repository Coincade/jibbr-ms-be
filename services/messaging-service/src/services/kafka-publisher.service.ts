import { kafkaClient, KAFKA_TOPICS } from '../config/kafka.js';

/**
 * Publish message created event to Kafka
 */
export async function publishMessageCreatedEvent(message: any) {
  try {
    await kafkaClient.sendMessage(KAFKA_TOPICS.MESSAGES, [
      {
        key: message.id,
        value: JSON.stringify({
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
        }),
        headers: {
          'content-type': 'application/json',
          'service': 'messaging-service',
          'event-type': 'message.created',
        },
      },
    ]);
    console.log('[Kafka] Published message.created event:', message.id);
  } catch (error) {
    console.error('[Kafka] Failed to publish message.created event:', error);
    // Don't throw - allow the request to succeed even if Kafka fails
  }
}

/**
 * Publish message updated event to Kafka
 */
export async function publishMessageUpdatedEvent(message: any) {
  try {
    await kafkaClient.sendMessage(KAFKA_TOPICS.MESSAGES, [
      {
        key: message.id,
        value: JSON.stringify({
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
        }),
        headers: {
          'content-type': 'application/json',
          'service': 'messaging-service',
          'event-type': 'message.updated',
        },
      },
    ]);
    console.log('[Kafka] Published message.updated event:', message.id);
  } catch (error) {
    console.error('[Kafka] Failed to publish message.updated event:', error);
    // Don't throw - allow the request to succeed even if Kafka fails
  }
}

/**
 * Publish message deleted event to Kafka
 */
export async function publishMessageDeletedEvent(message: any) {
  try {
    await kafkaClient.sendMessage(KAFKA_TOPICS.MESSAGES, [
      {
        key: message.id,
        value: JSON.stringify({
          type: 'message.deleted',
          data: {
            id: message.id,
            channelId: message.channelId || null,
            conversationId: message.conversationId || null,
            deletedAt: message.deletedAt?.toISOString() || new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        }),
        headers: {
          'content-type': 'application/json',
          'service': 'messaging-service',
          'event-type': 'message.deleted',
        },
      },
    ]);
    console.log('[Kafka] Published message.deleted event:', message.id);
  } catch (error) {
    console.error('[Kafka] Failed to publish message.deleted event:', error);
    // Don't throw - allow the request to succeed even if Kafka fails
  }
}
