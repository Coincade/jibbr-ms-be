import { describe, expect, it } from 'vitest';
import {
  deleteMessageSchema,
  forwardMessageSchema,
  getMessageSchema,
  getMessagesSchema,
  reactToMessageSchema,
  removeReactionSchema,
  sendDirectMessageSchema,
  sendMessageSchema,
  updateMessageSchema,
} from '../src/validation/message.validations.js';

const attachment = {
  filename: 'f',
  originalName: 'f.pdf',
  mimeType: 'application/pdf',
  size: 10,
  url: 'https://files.example/f',
};

describe('message validations', () => {
  it('accepts a send message with content and rejects an empty one', () => {
    expect(sendMessageSchema.safeParse({ content: 'hello', channelId: 'c1' }).success).toBe(true);
    const empty = sendMessageSchema.safeParse({ content: '   ', channelId: 'c1' });
    expect(empty.success).toBe(false);
    if (!empty.success) {
      expect(empty.error.issues.some((issue) => issue.path.includes('content'))).toBe(true);
    }
  });

  it('accepts a direct message and rejects one without a conversation', () => {
    expect(sendDirectMessageSchema.safeParse({ content: 'hello', conversationId: 'cv1' }).success).toBe(true);
    expect(sendDirectMessageSchema.safeParse({ content: 'hello', conversationId: '' }).success).toBe(false);
  });

  it('requires a message id and emoji to react', () => {
    expect(reactToMessageSchema.safeParse({ messageId: 'm1', emoji: '👍' }).success).toBe(true);
    expect(reactToMessageSchema.safeParse({ messageId: '', emoji: '👍' }).success).toBe(false);
  });

  it('requires both ids to forward a message', () => {
    expect(forwardMessageSchema.safeParse({ messageId: 'm1', channelId: 'c1' }).success).toBe(true);
    expect(forwardMessageSchema.safeParse({ messageId: 'm1', channelId: '' }).success).toBe(false);
  });

  it('defaults page and limit when listing messages and rejects a limit above 100', () => {
    const parsed = getMessagesSchema.safeParse({ channelId: 'c1' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.page).toBe(1);
      expect(parsed.data.limit).toBe(20);
    }
    expect(getMessagesSchema.safeParse({ channelId: 'c1', limit: 101 }).success).toBe(false);
  });

  it('requires a message id to fetch, delete, or remove a reaction', () => {
    expect(getMessageSchema.safeParse({ messageId: 'm1' }).success).toBe(true);
    expect(getMessageSchema.safeParse({ messageId: '' }).success).toBe(false);
    expect(deleteMessageSchema.safeParse({ messageId: 'm1' }).success).toBe(true);
    expect(deleteMessageSchema.safeParse({}).success).toBe(false);
    expect(removeReactionSchema.safeParse({ messageId: 'm1', emoji: '👍' }).success).toBe(true);
    expect(removeReactionSchema.safeParse({ messageId: 'm1', emoji: '' }).success).toBe(false);
  });

  it('requires content when updating a message', () => {
    expect(updateMessageSchema.safeParse({ messageId: 'm1', content: 'edited' }).success).toBe(true);
    expect(updateMessageSchema.safeParse({ messageId: 'm1', content: '' }).success).toBe(false);
  });

  it('accepts a message that only has an attachment', () => {
    expect(
      sendMessageSchema.safeParse({ content: '', channelId: 'c1', attachments: [attachment] }).success
    ).toBe(true);
  });
});
