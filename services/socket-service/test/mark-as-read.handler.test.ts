import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  channelMember: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  userRecent: {
    upsert: vi.fn(),
  },
  conversationParticipant: {
    findUnique: vi.fn(),
  },
  conversationReadStatus: {
    upsert: vi.fn(),
  },
}));

vi.mock('../src/config/database.js', () => ({ default: prisma }));

import { handleMarkAsRead } from '../src/websocket/handlers/mark-as-read.handler.js';

describe('mark-as-read.handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits auth error when socket user is missing', async () => {
    const emit = vi.fn();
    await handleMarkAsRead({ data: {}, emit } as any, { channelId: 'c1' });
    expect(emit).toHaveBeenCalledWith('error', { message: 'User not authenticated' });
  });

  it('emits validation error when neither channelId nor conversationId provided', async () => {
    const emit = vi.fn();
    await handleMarkAsRead({ data: { user: { id: 'u1' } }, emit } as any, {});
    expect(emit).toHaveBeenCalledWith('error', {
      message: 'channelId or conversationId is required',
    });
  });

  it('marks channel as read and emits ack', async () => {
    const emit = vi.fn();
    prisma.channelMember.findUnique.mockResolvedValue({
      channel: { workspaceId: 'w1' },
    });

    await handleMarkAsRead(
      { data: { user: { id: 'u1' } }, emit } as any,
      { channelId: 'c1', messageId: 'm1' }
    );

    expect(prisma.channelMember.update).toHaveBeenCalled();
    expect(prisma.userRecent.upsert).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      'mark_as_read_ack',
      expect.objectContaining({ success: true, channelId: 'c1' })
    );
  });

  it('emits error when user is not participant in conversation', async () => {
    const emit = vi.fn();
    prisma.conversationParticipant.findUnique.mockResolvedValue(null);

    await handleMarkAsRead(
      { data: { user: { id: 'u1' } }, emit } as any,
      { conversationId: 'cv1' }
    );

    expect(emit).toHaveBeenCalledWith('error', {
      message: 'You are not a participant of this conversation',
    });
  });

  it('marks conversation as read and emits ack', async () => {
    const emit = vi.fn();
    prisma.conversationParticipant.findUnique.mockResolvedValue({
      conversation: { workspaceId: 'w1' },
    });

    await handleMarkAsRead(
      { data: { user: { id: 'u1' } }, emit } as any,
      { conversationId: 'cv1' }
    );

    expect(prisma.conversationReadStatus.upsert).toHaveBeenCalled();
    expect(prisma.userRecent.upsert).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      'mark_as_read_ack',
      expect.objectContaining({ success: true, conversationId: 'cv1' })
    );
  });
});
