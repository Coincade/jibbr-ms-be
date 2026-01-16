import { kafkaClient, KAFKA_TOPICS } from '../config/kafka.js';
import { EachMessagePayload } from '@jibbr/kafka-client';
import { Server as SocketIOServer } from 'socket.io';

let ioInstance: SocketIOServer | null = null;

/**
 * Initialize Kafka consumer with Socket.IO instance
 */
export function setSocketIOInstance(io: SocketIOServer) {
  ioInstance = io;
}

/**
 * Start consuming messages from Kafka and broadcast to WebSocket clients
 */
export async function startKafkaConsumer() {
  if (!ioInstance) {
    throw new Error('Socket.IO instance not set. Call setSocketIOInstance() first.');
  }

  try {
    await kafkaClient.consumeMessages(
      'socket-service-group',
      [
        KAFKA_TOPICS.MESSAGES,
        KAFKA_TOPICS.NOTIFICATIONS,
        KAFKA_TOPICS.USER_EVENTS,
        KAFKA_TOPICS.WORKSPACE_EVENTS,
        KAFKA_TOPICS.CHANNEL_EVENTS,
      ],
      async (payload: EachMessagePayload) => {
        const topic = payload.topic;
        const message = JSON.parse(payload.message.value?.toString() || '{}');
        
        console.log(`[Kafka] Received message from topic ${topic}:`, message.type);
        
        // Process the message based on topic
        switch (topic) {
          case KAFKA_TOPICS.MESSAGES:
            await handleMessageEvent(message);
            break;
          case KAFKA_TOPICS.NOTIFICATIONS:
            await handleNotificationEvent(message);
            break;
          case KAFKA_TOPICS.USER_EVENTS:
            await handleUserEvent(message);
            break;
          case KAFKA_TOPICS.WORKSPACE_EVENTS:
            await handleWorkspaceEvent(message);
            break;
          case KAFKA_TOPICS.CHANNEL_EVENTS:
            await handleChannelEvent(message);
            break;
          default:
            console.warn('[Kafka] Unknown topic:', topic);
        }
      }
    );
    console.log('[Kafka] Consumer started and listening for events');
  } catch (error) {
    console.error('[Kafka] Failed to start consumer:', error);
    throw error;
  }
}

/**
 * Handle message events from Kafka
 */
async function handleMessageEvent(message: any) {
  if (!ioInstance) return;

  const { type, data } = message;

  switch (type) {
    case 'message.created':
      // Broadcast new message to channel or conversation
      if (data.channelId) {
        ioInstance.to(data.channelId).emit('new_message', {
          message: data,
          timestamp: message.timestamp,
        });
        console.log(`[Kafka] Broadcasted message.created to channel: ${data.channelId}`);
      } else if (data.conversationId) {
        // For DMs, broadcast to conversation room
        ioInstance.to(`conversation:${data.conversationId}`).emit('new_direct_message', {
          message: data,
          timestamp: message.timestamp,
        });
        console.log(`[Kafka] Broadcasted message.created to conversation: ${data.conversationId}`);
      }
      break;

    case 'message.updated':
      // Broadcast message update
      if (data.channelId) {
        ioInstance.to(data.channelId).emit('message_edited', {
          messageId: data.id,
          content: data.content,
          updatedAt: data.updatedAt,
          timestamp: message.timestamp,
        });
        console.log(`[Kafka] Broadcasted message.updated to channel: ${data.channelId}`);
      } else if (data.conversationId) {
        ioInstance.to(`conversation:${data.conversationId}`).emit('direct_message_edited', {
          messageId: data.id,
          content: data.content,
          updatedAt: data.updatedAt,
          timestamp: message.timestamp,
        });
        console.log(`[Kafka] Broadcasted message.updated to conversation: ${data.conversationId}`);
      }
      break;

    case 'message.deleted':
      // Broadcast message deletion
      if (data.channelId) {
        ioInstance.to(data.channelId).emit('message_deleted', {
          messageId: data.id,
          deletedAt: data.deletedAt,
          timestamp: message.timestamp,
        });
        console.log(`[Kafka] Broadcasted message.deleted to channel: ${data.channelId}`);
      } else if (data.conversationId) {
        ioInstance.to(`conversation:${data.conversationId}`).emit('direct_message_deleted', {
          messageId: data.id,
          deletedAt: data.deletedAt,
          timestamp: message.timestamp,
        });
        console.log(`[Kafka] Broadcasted message.deleted to conversation: ${data.conversationId}`);
      }
      break;

    default:
      console.warn('[Kafka] Unknown message event type:', type);
  }
}

/**
 * Handle notification events from Kafka
 */
async function handleNotificationEvent(message: any) {
  if (!ioInstance) return;

  const { type, data } = message;

  switch (type) {
    case 'notification.created':
      // Send notification to specific user
      if (data.userId) {
        ioInstance.to(`user:${data.userId}`).emit('notification', {
          notification: data,
          timestamp: message.timestamp,
        });
        console.log(`[Kafka] Sent notification to user: ${data.userId}`);
      }
      break;

    default:
      console.warn('[Kafka] Unknown notification event type:', type);
  }
}

/**
 * Handle user events from Kafka
 */
async function handleUserEvent(message: any) {
  if (!ioInstance) return;

  const { type, data } = message;

  switch (type) {
    case 'user.created':
      // Broadcast user creation to all connected clients (optional)
      ioInstance.emit('user_created', {
        user: data,
        timestamp: message.timestamp,
      });
      console.log('[Kafka] Broadcasted user.created event');
      break;

    case 'user.updated':
      // Broadcast user update
      ioInstance.emit('user_updated', {
        user: data,
        timestamp: message.timestamp,
      });
      console.log('[Kafka] Broadcasted user.updated event');
      break;

    case 'user.deleted':
      // Broadcast user deletion
      ioInstance.emit('user_deleted', {
        userId: data.id,
        timestamp: message.timestamp,
      });
      console.log('[Kafka] Broadcasted user.deleted event');
      break;

    default:
      console.warn('[Kafka] Unknown user event type:', type);
  }
}

/**
 * Handle workspace events from Kafka
 */
async function handleWorkspaceEvent(message: any) {
  if (!ioInstance) return;

  const { type, data } = message;

  switch (type) {
    case 'workspace.created':
      // Broadcast to workspace members
      if (data.id) {
        ioInstance.to(`workspace:${data.id}`).emit('workspace_created', {
          workspace: data,
          timestamp: message.timestamp,
        });
        console.log(`[Kafka] Broadcasted workspace.created to workspace: ${data.id}`);
      }
      break;

    case 'workspace.updated':
      if (data.id) {
        ioInstance.to(`workspace:${data.id}`).emit('workspace_updated', {
          workspace: data,
          timestamp: message.timestamp,
        });
        console.log(`[Kafka] Broadcasted workspace.updated to workspace: ${data.id}`);
      }
      break;

    case 'workspace.deleted':
      if (data.id) {
        ioInstance.to(`workspace:${data.id}`).emit('workspace_deleted', {
          workspaceId: data.id,
          timestamp: message.timestamp,
        });
        console.log(`[Kafka] Broadcasted workspace.deleted to workspace: ${data.id}`);
      }
      break;

    default:
      console.warn('[Kafka] Unknown workspace event type:', type);
  }
}

/**
 * Handle channel events from Kafka
 */
async function handleChannelEvent(message: any) {
  if (!ioInstance) return;

  const { type, data } = message;

  switch (type) {
    case 'channel.created':
      // Broadcast to workspace members
      if (data.workspaceId) {
        ioInstance.to(`workspace:${data.workspaceId}`).emit('channel_created', {
          channel: data,
          timestamp: message.timestamp,
        });
        console.log(`[Kafka] Broadcasted channel.created to workspace: ${data.workspaceId}`);
      }
      break;

    case 'channel.updated':
      if (data.id) {
        ioInstance.to(data.id).emit('channel_updated', {
          channel: data,
          timestamp: message.timestamp,
        });
        console.log(`[Kafka] Broadcasted channel.updated to channel: ${data.id}`);
      }
      break;

    case 'channel.deleted':
      if (data.id) {
        ioInstance.to(data.id).emit('channel_deleted', {
          channelId: data.id,
          timestamp: message.timestamp,
        });
        console.log(`[Kafka] Broadcasted channel.deleted to channel: ${data.id}`);
      }
      break;

    default:
      console.warn('[Kafka] Unknown channel event type:', type);
  }
}
