import { describe, expect, it } from 'vitest';

import {
  reactToMessageSchema,
  sendDirectMessageSchema,
  sendMessageSchema,
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
});
