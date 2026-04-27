import { randomUUID } from 'crypto';
import { createStreamRedisClient } from '../config/redis.js';
import { STREAMS } from '../config/streams.js';

type StreamEvent = {
  eventId: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
  source: string;
};

type StreamRedisClient = Awaited<ReturnType<typeof createStreamRedisClient>>;
let streamClientPromise: Promise<StreamRedisClient> | null = null;

const getStreamClient = async (): Promise<StreamRedisClient> => {
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

/**
 * Publish user status changed event to Valkey Streams (socket-service broadcasts via WebSocket)
 */
export async function publishUserStatusChangedEvent(
  userId: string,
  status: string,
  customMessage?: string | null
) {
  try {
    const event: StreamEvent = {
      eventId: randomUUID(),
      type: 'user.status_changed',
      data: {
        userId,
        status,
        customMessage: customMessage ?? '',
      },
      timestamp: new Date().toISOString(),
      source: 'messaging-service',
    };

    await publishEvent(STREAMS.USER_EVENTS, event);
    console.log('[Streams] Published user.status_changed event:', userId);
  } catch (error) {
    console.error('[Streams] Failed to publish user.status_changed event:', error);
  }
}

export async function publishChannelMembershipUpdatedEvent(payload: {
  userId: string;
  channelId: string;
  action: 'add' | 'remove';
}) {
  try {
    const event: StreamEvent = {
      eventId: randomUUID(),
      type: 'membership.channel.updated',
      data: payload,
      timestamp: new Date().toISOString(),
      source: 'messaging-service',
    };
    await publishEvent(STREAMS.USER_EVENTS, event);
  } catch (error) {
    console.error('[Streams] Failed to publish membership.channel.updated event:', error);
  }
}

export async function publishConversationMembershipUpdatedEvent(payload: {
  userId: string;
  conversationId: string;
  action: 'add' | 'remove';
}) {
  try {
    const event: StreamEvent = {
      eventId: randomUUID(),
      type: 'membership.conversation.updated',
      data: payload,
      timestamp: new Date().toISOString(),
      source: 'messaging-service',
    };
    await publishEvent(STREAMS.USER_EVENTS, event);
  } catch (error) {
    console.error('[Streams] Failed to publish membership.conversation.updated event:', error);
  }
}

export const publishChannelMembershipUpdatedEventNow = publishChannelMembershipUpdatedEvent;
export const publishConversationMembershipUpdatedEventNow = publishConversationMembershipUpdatedEvent;

export async function publishWorkspaceEvent(
  type: 'workspace.created' | 'workspace.updated' | 'workspace.deleted',
  workspace: any
) {
  try {
    const event: StreamEvent = {
      eventId: randomUUID(),
      type,
      data: {
        id: workspace.id,
        name: workspace.name,
        joinCode: workspace.joinCode,
        userId: workspace.userId,
        type: workspace.type ?? null,
        description: workspace.description ?? null,
        imageUrl: workspace.imageUrl ?? null,
        fileAttachmentsEnabled: workspace.fileAttachmentsEnabled ?? null,
        isActive: workspace.isActive ?? true,
        deletedAt:
          workspace.deletedAt instanceof Date
            ? workspace.deletedAt.toISOString()
            : workspace.deletedAt ?? null,
        updatedAt:
          workspace.updatedAt instanceof Date
            ? workspace.updatedAt.toISOString()
            : workspace.updatedAt ?? null,
      },
      timestamp: new Date().toISOString(),
      source: 'messaging-service',
    };

    await publishEvent(STREAMS.WORKSPACE_EVENTS, event);
    console.log(`[Streams] Published ${type} event:`, workspace.id);
  } catch (error) {
    console.error(`[Streams] Failed to publish ${type} event:`, error);
  }
}

export type CollaborationInvalidateReason =
  | 'request_created'
  | 'request_rejected'
  | 'link_approved'
  | 'link_revoked'
  | 'shared_channel_created'
  | 'external_dm_created'
  | 'group_invite_sent'
  | 'group_invite_accepted'
  | 'group_invite_rejected'
  | 'group_membership_revoked'
  | 'group_channel_created';

/**
 * Notify all members in affected workspaces to refresh collaboration-derived UI
 * (admin requests/links, federated DM list, shared channel list on the partner workspace).
 */
export async function publishCollaborationInvalidate(payload: {
  workspaceIds: string[];
  reason: CollaborationInvalidateReason;
  collaborationId?: string | null;
  channelId?: string | null;
  conversationId?: string | null;
  requestId?: string | null;
}) {
  try {
    const uniqueIds = [...new Set(payload.workspaceIds.filter(Boolean))];
    if (uniqueIds.length === 0) return;

    const event: StreamEvent = {
      eventId: randomUUID(),
      type: 'collaboration.updated',
      data: {
        workspaceIds: uniqueIds,
        reason: payload.reason,
        collaborationId: payload.collaborationId ?? null,
        channelId: payload.channelId ?? null,
        conversationId: payload.conversationId ?? null,
        requestId: payload.requestId ?? null,
      },
      timestamp: new Date().toISOString(),
      source: 'messaging-service',
    };

    await publishEvent(STREAMS.WORKSPACE_EVENTS, event);
    console.log('[Streams] Published collaboration.updated:', payload.reason, uniqueIds);
  } catch (error) {
    console.error('[Streams] Failed to publish collaboration.updated event:', error);
  }
}

export async function publishChannelEvent(
  type: 'channel.created' | 'channel.updated' | 'channel.deleted',
  channel: any
) {
  try {
    const event: StreamEvent = {
      eventId: randomUUID(),
      type,
      data: {
        id: channel.id,
        name: channel.name,
        typeValue: channel.type ?? null,
        type: channel.type ?? null,
        workspaceId: channel.workspaceId,
        image: channel.image ?? null,
        channelAdminId: channel.channelAdminId ?? null,
        isBridgeChannel: channel.isBridgeChannel ?? false,
        deletedAt:
          channel.deletedAt instanceof Date
            ? channel.deletedAt.toISOString()
            : channel.deletedAt ?? null,
        createdAt:
          channel.createdAt instanceof Date
            ? channel.createdAt.toISOString()
            : channel.createdAt ?? null,
        updatedAt:
          channel.updatedAt instanceof Date
            ? channel.updatedAt.toISOString()
            : channel.updatedAt ?? null,
      },
      timestamp: new Date().toISOString(),
      source: 'messaging-service',
    };

    await publishEvent(STREAMS.CHANNEL_EVENTS, event);
    console.log(`[Streams] Published ${type} event:`, channel.id);
  } catch (error) {
    console.error(`[Streams] Failed to publish ${type} event:`, error);
  }
}
