// Export Prisma Client from the shared database package
export { PrismaClient } from '@prisma/client';

// Re-export types for convenience
export type {
  User,
  Workspace,
  Channel,
  Conversation,
  ConversationParticipant,
  Message,
  Attachment,
  Reaction,
  ForwardedMessage,
  Member,
  ChannelMember,
  UserNotification,
  ConversationReadStatus,
  UserNotificationPreference,
  MessageMention,
  UserPushToken,
  ChannelType,
  Role,
  NotificationType,
  PushPlatform,
} from '@prisma/client';

