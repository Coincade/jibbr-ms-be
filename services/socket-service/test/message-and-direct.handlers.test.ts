import { beforeEach, describe, expect, it, vi } from 'vitest';

const validateChannelMembership = vi.hoisted(() => vi.fn(async () => true));
const validateConversationParticipation = vi.hoisted(() => vi.fn(async () => true));
const assertCanMutateSharedChannel = vi.hoisted(() => vi.fn(async () => undefined));
const getUserInfo = vi.hoisted(() => vi.fn(async () => ({ id: 'u1', name: 'User' })));
const isCollaborationDmMutationAllowed = vi.hoisted(() => vi.fn(async () => true));
const prisma = vi.hoisted(() => ({
  message: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  attachment: {
    createMany: vi.fn(),
    findMany: vi.fn(async () => []),
  },
  forwardedMessage: {
    create: vi.fn(),
  },
  reaction: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
  },
  channel: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  messageMention: {
    findMany: vi.fn(async () => []),
  },
}));

vi.mock('../src/websocket/utils.js', () => ({
  validateChannelMembership,
  validateConversationParticipation,
  assertCanMutateSharedChannel,
  getUserInfo,
  isCollaborationDmMutationAllowed,
}));

vi.mock('../src/services/mention.service.js', () => ({
  processMentions: vi.fn(async (content: string) => ({
    sanitizedContent: content,
    mentionedUserIds: [],
  })),
  createMentionsAndNotifications: vi.fn(async () => undefined),
  updateMentionsForMessage: vi.fn(async () => undefined),
}));

vi.mock('../src/helper.js', () => ({
  canUserSendAttachmentsToChannel: vi.fn(async () => true),
  canUserSendAttachmentsToConversation: vi.fn(async () => true),
  canUserForwardInTownhall: vi.fn(async () => true),
  isTownhallChannelName: vi.fn(() => false),
}));

vi.mock('../src/libs/htmlToCleanText.js', () => ({
  htmlToCleanText: vi.fn((value: string) => value),
}));

vi.mock('../src/services/notification.service.js', () => ({
  NotificationService: {
    notifyNewChannelMessage: vi.fn(async () => undefined),
    notifyNewDirectMessage: vi.fn(async () => undefined),
  },
}));
vi.mock('../src/config/database.js', () => ({
  default: prisma,
}));

function createSocket(withUser = true) {
  const toEmit = vi.fn();
  return {
    data: withUser ? { user: { id: 'u1', name: 'User' } } : {},
    emit: vi.fn(),
    to: vi.fn(() => ({ emit: toEmit })),
  } as any;
}

describe('message/direct handlers - critical error paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleSendMessage emits auth error for unauthenticated socket', async () => {
    const { handleSendMessage } = await import('../src/websocket/handlers/message.handler.js');
    const socket = createSocket(false);

    await handleSendMessage(socket, { content: 'Hello', channelId: 'c1' } as any, new Map(), {} as any);

    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: 'User not authenticated' })
    );
  });

  it('handleSendMessage emits validation error for invalid payload', async () => {
    const { handleSendMessage } = await import('../src/websocket/handlers/message.handler.js');
    const socket = createSocket(true);

    await handleSendMessage(
      socket,
      { content: '', channelId: 'c1', clientMessageId: 'cm1' } as any,
      new Map(),
      {} as any
    );

    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({
        message: 'Invalid message data',
        channelId: 'c1',
        clientMessageId: 'cm1',
      })
    );
  });

  it('handleSendMessage emits membership error when user is not in channel', async () => {
    const { handleSendMessage } = await import('../src/websocket/handlers/message.handler.js');
    const socket = createSocket(true);
    validateChannelMembership.mockResolvedValueOnce(false);

    await handleSendMessage(socket, { content: 'Hello', channelId: 'c1' } as any, new Map(), {} as any);

    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: 'You are not a member of this channel' })
    );
  });

  it('handleSendDirectMessage emits auth error for unauthenticated socket', async () => {
    const { handleSendDirectMessage } = await import(
      '../src/websocket/handlers/direct-message.handler.js'
    );
    const socket = createSocket(false);

    await handleSendDirectMessage(
      socket,
      { content: 'Hello', conversationId: 'cv1' } as any,
      new Map(),
      {} as any
    );

    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: 'User not authenticated' })
    );
  });

  it('handleSendDirectMessage emits validation error for invalid payload', async () => {
    const { handleSendDirectMessage } = await import(
      '../src/websocket/handlers/direct-message.handler.js'
    );
    const socket = createSocket(true);

    await handleSendDirectMessage(
      socket,
      { content: '', conversationId: 'cv1', clientMessageId: 'cm1' } as any,
      new Map(),
      {} as any
    );

    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({
        message: 'Invalid message data',
        conversationId: 'cv1',
        clientMessageId: 'cm1',
      })
    );
  });

  it('handleSendDirectMessage emits participation error when user is not in conversation', async () => {
    const { handleSendDirectMessage } = await import(
      '../src/websocket/handlers/direct-message.handler.js'
    );
    const socket = createSocket(true);
    validateConversationParticipation.mockResolvedValueOnce(false);

    await handleSendDirectMessage(
      socket,
      { content: 'Hello', conversationId: 'cv1' } as any,
      new Map(),
      {} as any
    );

    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({
        message: 'You are not a participant of this conversation',
      })
    );
  });

  it('handleEditMessage sends noop ack when message is missing and clientOpId provided', async () => {
    const { handleEditMessage } = await import('../src/websocket/handlers/message.handler.js');
    const socket = createSocket(true);
    prisma.message.findUnique.mockResolvedValueOnce(null);

    await handleEditMessage(
      socket,
      { messageId: 'm1', channelId: 'c1', content: 'updated', clientOpId: 'op-edit-1' } as any,
      new Map(),
      {} as any
    );

    expect(socket.emit).toHaveBeenCalledWith(
      'message_edited_ack',
      expect.objectContaining({
        clientOpId: 'op-edit-1',
        messageId: 'm1',
        channelId: 'c1',
        noop: true,
      })
    );
  });

  it('handleDeleteMessage sends noop ack when already deleted and clientOpId provided', async () => {
    const { handleDeleteMessage } = await import('../src/websocket/handlers/message.handler.js');
    const socket = createSocket(true);
    prisma.message.findUnique.mockResolvedValueOnce({
      id: 'm1',
      userId: 'u1',
      deletedAt: new Date(),
    });

    await handleDeleteMessage(
      socket,
      { messageId: 'm1', channelId: 'c1', clientOpId: 'op-del-1' } as any,
      new Map()
    );

    expect(socket.emit).toHaveBeenCalledWith(
      'message_deleted_ack',
      expect.objectContaining({
        clientOpId: 'op-del-1',
        messageId: 'm1',
        channelId: 'c1',
        noop: true,
      })
    );
  });

  it('handleEditDirectMessage sends noop ack when message is missing and clientOpId provided', async () => {
    const { handleEditDirectMessage } = await import(
      '../src/websocket/handlers/direct-message.handler.js'
    );
    const socket = createSocket(true);
    prisma.message.findUnique.mockResolvedValueOnce(null);

    await handleEditDirectMessage(
      socket,
      {
        messageId: 'm1',
        conversationId: 'cv1',
        content: 'updated',
        clientOpId: 'op-dm-edit-1',
      } as any,
      new Map()
    );

    expect(socket.emit).toHaveBeenCalledWith(
      'direct_message_edited_ack',
      expect.objectContaining({
        clientOpId: 'op-dm-edit-1',
        messageId: 'm1',
        conversationId: 'cv1',
        noop: true,
      })
    );
  });

  it('handleDeleteDirectMessage sends noop ack when message is missing and clientOpId provided', async () => {
    const { handleDeleteDirectMessage } = await import(
      '../src/websocket/handlers/direct-message.handler.js'
    );
    const socket = createSocket(true);
    prisma.message.findUnique.mockResolvedValueOnce(null);

    await handleDeleteDirectMessage(
      socket,
      { messageId: 'm1', conversationId: 'cv1', clientOpId: 'op-dm-del-1' } as any,
      new Map()
    );

    expect(socket.emit).toHaveBeenCalledWith(
      'direct_message_deleted_ack',
      expect.objectContaining({
        clientOpId: 'op-dm-del-1',
        messageId: 'm1',
        conversationId: 'cv1',
        noop: true,
      })
    );
  });
});
