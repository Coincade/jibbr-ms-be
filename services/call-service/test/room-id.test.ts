import { describe, expect, it } from 'vitest';
import {
  conversationIdFromRoom,
  conversationRoomId,
  isConversationRoom,
} from '../src/utils/room-id.js';

describe('room id helpers', () => {
  it('prefixes a conversation id', () => {
    expect(conversationRoomId('c1')).toBe('conv:c1');
  });

  it('detects conversation rooms', () => {
    expect(isConversationRoom('conv:c1')).toBe(true);
    expect(isConversationRoom('channel-1')).toBe(false);
  });

  it('reads the conversation id back out of a room id', () => {
    expect(conversationIdFromRoom('conv:c1')).toBe('c1');
    expect(conversationIdFromRoom('channel-1')).toBeNull();
  });
});
