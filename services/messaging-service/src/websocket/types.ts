import { Socket } from 'socket.io';
import { JwtPayload } from 'jsonwebtoken';

// Re-export Socket for convenience
export { Socket };

// Socket.IO client with user info
export interface SocketWithUser extends Socket {
  data: {
    user?: JwtPayload & { id: string; name?: string; image?: string };
  };
}

// Client message types (from client to server)
export interface ClientMessage {
  type: string;
  [key: string]: any;
}

export interface SendMessageMessage extends ClientMessage {
  type: 'send_message';
  content: string;
  channelId?: string; // Optional for channel messages
  conversationId?: string; // Optional for direct messages
  replyToId?: string;
  attachments?: AttachmentData[]; // File references from upload API
}

export interface SendDirectMessageMessage extends ClientMessage {
  type: 'send_direct_message';
  content: string;
  conversationId: string;
  replyToId?: string;
  attachments?: AttachmentData[];
}

export interface EditMessageMessage extends ClientMessage {
  type: 'edit_message';
  messageId: string;
  content: string;
  channelId?: string;
  conversationId?: string;
}

export interface EditDirectMessageMessage extends ClientMessage {
  type: 'edit_direct_message';
  messageId: string;
  content: string;
  conversationId: string;
}

export interface DeleteMessageMessage extends ClientMessage {
  type: 'delete_message';
  messageId: string;
  channelId?: string;
  conversationId?: string;
}

export interface DeleteDirectMessageMessage extends ClientMessage {
  type: 'delete_direct_message';
  messageId: string;
  conversationId: string;
}

export interface ForwardMessageMessage extends ClientMessage {
  type: 'forward_message';
  messageId: string;
  targetChannelId: string;
  channelId: string;
}

export interface ForwardToDirectMessage extends ClientMessage {
  type: 'forward_to_direct';
  messageId: string;
  targetConversationId: string;
  channelId: string;
}

export interface AddReactionMessage extends ClientMessage {
  type: 'add_reaction';
  messageId: string;
  emoji: string;
  channelId?: string;
  conversationId?: string;
}

export interface AddDirectReactionMessage extends ClientMessage {
  type: 'add_direct_reaction';
  messageId: string;
  emoji: string;
  conversationId: string;
}

export interface RemoveReactionMessage extends ClientMessage {
  type: 'remove_reaction';
  messageId: string;
  emoji: string;
  channelId?: string;
  conversationId?: string;
}

export interface RemoveDirectReactionMessage extends ClientMessage {
  type: 'remove_direct_reaction';
  messageId: string;
  emoji: string;
  conversationId: string;
}

// Direct messaging events
export interface JoinConversationMessage extends ClientMessage {
  type: 'join_conversation';
  conversationId: string;
}

export interface LeaveConversationMessage extends ClientMessage {
  type: 'leave_conversation';
  conversationId: string;
}

// Server message types (from server to client)
export interface ServerMessage {
  type: string;
  [key: string]: any;
}

export interface NewMessageEvent extends ServerMessage {
  type: 'new_message';
  message: MessageData;
}

export interface NewDirectMessageEvent extends ServerMessage {
  type: 'new_direct_message';
  message: DirectMessageData;
}

export interface MessageEditedEvent extends ServerMessage {
  type: 'message_edited';
  messageId: string;
  content: string;
}

export interface DirectMessageEditedEvent extends ServerMessage {
  type: 'direct_message_edited';
  messageId: string;
  content: string;
}

export interface MessageDeletedEvent extends ServerMessage {
  type: 'message_deleted';
  messageId: string;
}

export interface DirectMessageDeletedEvent extends ServerMessage {
  type: 'direct_message_deleted';
  messageId: string;
}

export interface MessageForwardedEvent extends ServerMessage {
  type: 'message_forwarded';
  originalMessage: MessageData;
  targetChannelId: string;
}

export interface MessageForwardedToDirectEvent extends ServerMessage {
  type: 'message_forwarded_to_direct';
  originalMessage: MessageData;
  targetConversationId: string;
}

export interface ReactionAddedEvent extends ServerMessage {
  type: 'reaction_added';
  reaction: ReactionData;
}

export interface DirectReactionAddedEvent extends ServerMessage {
  type: 'direct_reaction_added';
  reaction: ReactionData;
}

export interface ReactionRemovedEvent extends ServerMessage {
  type: 'reaction_removed';
  messageId: string;
  emoji: string;
  userId: string;
}

export interface DirectReactionRemovedEvent extends ServerMessage {
  type: 'direct_reaction_removed';
  messageId: string;
  emoji: string;
  userId: string;
}

// Notification events
export interface UnreadCountsUpdatedEvent extends ServerMessage {
  type: 'unread_counts_updated';
  data: {
    totalUnread: number;
    channels: Array<{
      channelId: string;
      channelName: string;
      workspaceId: string;
      unreadCount: number;
      lastReadAt: string | null;
    }>;
    conversations: Array<{
      conversationId: string;
      participant: {
        id: string;
        name?: string;
        image?: string;
      } | null;
      unreadCount: number;
      lastReadAt: string | null;
    }>;
  };
}

export interface NewNotificationEvent extends ServerMessage {
  type: 'new_notification';
  notification: {
    id: string;
    type: string;
    title: string;
    message: string;
    data?: any;
    createdAt: string;
  };
}

export interface ConversationJoinedEvent extends ServerMessage {
  type: 'conversation_joined';
  conversationId: string;
}

export interface ConversationLeftEvent extends ServerMessage {
  type: 'conversation_left';
  conversationId: string;
}

export interface ErrorEvent extends ServerMessage {
  type: 'error';
  message: string;
}

export interface PongEvent extends ServerMessage {
  type: 'pong';
  timestamp: number;
}

// Data types
export interface MessageData {
  id: string;
  content: string;
  channelId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  replyToId?: string | null;
  user: {
    id: string;
    name?: string;
    image?: string;
  };
  attachments: AttachmentData[];
  reactions: ReactionData[];
}

export interface DirectMessageData {
  id: string;
  content: string;
  conversationId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  replyToId?: string | null;
  user: {
    id: string;
    name?: string;
    image?: string;
  };
  attachments: AttachmentData[];
  reactions: ReactionData[];
}

export interface ConversationData {
  id: string;
  createdAt: string;
  updatedAt: string;
  participants: ConversationParticipantData[];
  lastMessage?: DirectMessageData;
  unreadCount?: number;
}

export interface ConversationParticipantData {
  id: string;
  userId: string;
  user: {
    id: string;
    name?: string;
    image?: string;
  };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReactionData {
  id: string;
  emoji: string;
  messageId: string;
  userId: string;
  createdAt: string;
  user: {
    id: string;
    name?: string;
  };
}

export interface AttachmentData {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
}

// Channel clients mapping (simplified - no join/leave tracking)
export type ChannelClientsMap = Map<string, Set<Socket>>;

// Conversation clients mapping for direct messages
export type ConversationClientsMap = Map<string, Set<Socket>>; 