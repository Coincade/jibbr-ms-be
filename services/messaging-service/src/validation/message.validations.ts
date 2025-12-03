import { z } from "zod";

// Send message validation
export const sendMessageSchema = z.object({
  content: z.string().max(2000, "Message too long"),
  channelId: z.string().min(1, "Channel ID is required"),
  replyToId: z.string().optional(), // Optional reply to another message
  attachments: z.array(z.object({
    filename: z.string(),
    originalName: z.string(),
    mimeType: z.string(),
    size: z.number(),
    url: z.string(),
  })).optional(),
}).refine(
  (data) => (data.content && data.content.trim().length > 0) || (data.attachments && data.attachments.length > 0),
  {
    message: "Message must have either content or at least one attachment.",
    path: ["content"],
  }
);

// Send direct message validation
export const sendDirectMessageSchema = z.object({
  content: z.string().max(2000, "Message too long"),
  conversationId: z.string().min(1, "Conversation ID is required"),
  replyToId: z.string().optional(), // Optional reply to another message
  attachments: z.array(z.object({
    filename: z.string(),
    originalName: z.string(),
    mimeType: z.string(),
    size: z.number(),
    url: z.string(),
  })).optional(),
}).refine(
  (data) => (data.content && data.content.trim().length > 0) || (data.attachments && data.attachments.length > 0),
  {
    message: "Message must have either content or at least one attachment.",
    path: ["content"],
  }
);

// React to message validation
export const reactToMessageSchema = z.object({
  messageId: z.string().min(1, "Message ID is required"),
  emoji: z.string().min(1, "Emoji is required").max(10, "Emoji too long"),
});

// Forward message validation
export const forwardMessageSchema = z.object({
  messageId: z.string().min(1, "Message ID is required"),
  channelId: z.string().min(1, "Channel ID is required"),
});

// Get messages validation
export const getMessagesSchema = z.object({
  channelId: z.string().min(1, "Channel ID is required"),
  page: z.coerce.number().min(1, "Page must be at least 1").default(1),
  limit: z.coerce.number().min(1, "Limit must be at least 1").max(100, "Limit too high").default(20),
});

// Get message by ID validation
export const getMessageSchema = z.object({
  messageId: z.string().min(1, "Message ID is required"),
});

// Delete message validation
export const deleteMessageSchema = z.object({
  messageId: z.string().min(1, "Message ID is required"),
});

// Update message validation
export const updateMessageSchema = z.object({
  messageId: z.string().min(1, "Message ID is required"),
  content: z.string().min(1, "Message content is required").max(2000, "Message too long"),
});

// Remove reaction validation
export const removeReactionSchema = z.object({
  messageId: z.string().min(1, "Message ID is required"),
  emoji: z.string().min(1, "Emoji is required"),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SendDirectMessageInput = z.infer<typeof sendDirectMessageSchema>;
export type ReactToMessageInput = z.infer<typeof reactToMessageSchema>;
export type ForwardMessageInput = z.infer<typeof forwardMessageSchema>;
export type GetMessagesInput = z.infer<typeof getMessagesSchema>;
export type GetMessageInput = z.infer<typeof getMessageSchema>;
export type DeleteMessageInput = z.infer<typeof deleteMessageSchema>;
export type UpdateMessageInput = z.infer<typeof updateMessageSchema>;
export type RemoveReactionInput = z.infer<typeof removeReactionSchema>; 