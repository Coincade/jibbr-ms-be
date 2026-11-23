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

describe('message validations', () => {
  it('rejects empty sendMessage without attachments', () => {
    const result = sendMessageSchema.safeParse({ content: '   ', channelId: 'c1' });
    expect(result.success).toBe(false);
  });

  it('accepts sendMessage with attachment only', () => {
    const result = sendMessageSchema.safeParse({
      content: '',
      channelId: 'c1',
      attachments: [{ filename: 'f', originalName: 'f', mimeType: 'text/plain', size: 1, url: 'u' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts direct message content flow', () => {
    const result = sendDirectMessageSchema.safeParse({
      content: 'hello',
      conversationId: 'cv1',
    });
    expect(result.success).toBe(true);
  });

  it('react schema requires messageId and emoji', () => {
    const result = reactToMessageSchema.safeParse({ messageId: '', emoji: '' });
    expect(result.success).toBe(false);
  });

  it('requires both ids to forward a message', () => {
    expect(forwardMessageSchema.safeParse({ messageId: 'm1', channelId: 'c1' }).success).toBe(true);
    expect(forwardMessageSchema.safeParse({ messageId: 'm1' }).success).toBe(false);
  });

  it('defaults the message list page and rejects an empty channel id', () => {
    const parsed = getMessagesSchema.safeParse({ channelId: 'c1' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.page).toBe(1);
      expect(parsed.data.limit).toBe(20);
    }
    expect(getMessagesSchema.safeParse({ channelId: '' }).success).toBe(false);
  });

  it('requires a message id to fetch or delete', () => {
    expect(getMessageSchema.safeParse({ messageId: 'm1' }).success).toBe(true);
    expect(getMessageSchema.safeParse({ messageId: '' }).success).toBe(false);
    expect(deleteMessageSchema.safeParse({ messageId: 'm1' }).success).toBe(true);
    expect(deleteMessageSchema.safeParse({}).success).toBe(false);
  });

  it('requires content to update and an emoji to remove a reaction', () => {
    expect(updateMessageSchema.safeParse({ messageId: 'm1', content: 'edited' }).success).toBe(true);
    expect(updateMessageSchema.safeParse({ messageId: 'm1', content: '' }).success).toBe(false);
    expect(removeReactionSchema.safeParse({ messageId: 'm1', emoji: '👍' }).success).toBe(true);
    expect(removeReactionSchema.safeParse({ messageId: 'm1', emoji: '' }).success).toBe(false);
  });
});
