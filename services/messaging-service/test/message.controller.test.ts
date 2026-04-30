import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  channelMember: { findFirst: vi.fn() },
  message: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  member: { findFirst: vi.fn() },
  reaction: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
  forwardedMessage: { findMany: vi.fn(), count: vi.fn() },
}));

const helper = vi.hoisted(() => ({
  formatError: vi.fn(() => ({ field: 'invalid' })),
  canUserSendAttachmentsToChannel: vi.fn(),
  canUserForwardInTownhall: vi.fn(),
  isTownhallChannelName: vi.fn(() => false),
}));

const mentionService = vi.hoisted(() => ({
  processMentions: vi.fn(),
  createMentionsAndNotifications: vi.fn(),
  updateMentionsForMessage: vi.fn(),
}));

const streams = vi.hoisted(() => ({
  publishMessageCreatedEvent: vi.fn(() => Promise.resolve()),
  publishMessageUpdatedEvent: vi.fn(() => Promise.resolve()),
  publishMessageDeletedEvent: vi.fn(() => Promise.resolve()),
}));

const collabAccess = vi.hoisted(() => ({
  canUserMutateSharedChannel: vi.fn(),
  canUserReadChannelHistory: vi.fn(),
  canUserReadConversationHistory: vi.fn(),
}));

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('../src/helper.js', () => helper);
vi.mock('../src/config/upload.js', () => ({
  uploadToSpaces: vi.fn(),
  deleteFromSpaces: vi.fn(),
}));
vi.mock('../src/services/mention.service.js', () => mentionService);
vi.mock('../src/libs/htmlToCleanText.js', () => ({ htmlToCleanText: vi.fn((s: string) => s) }));
vi.mock('../src/services/streams-publisher.service.js', () => streams);
vi.mock('../src/helpers/collaborationAccess.js', () => collabAccess);

import {
  buildForwardedContent,
  deleteMessage,
  getMessage,
  getMessages,
  getForwardedMessages,
  reactToMessage,
  removeReaction,
  sendMessage,
  updateMessage,
} from '../src/controllers/message.controller.js';

function createRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('message.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mentionService.processMentions.mockResolvedValue({ sanitizedContent: 'hello', mentionedUserIds: [] });
    collabAccess.canUserMutateSharedChannel.mockResolvedValue(true);
    collabAccess.canUserReadChannelHistory.mockResolvedValue(true);
    collabAccess.canUserReadConversationHistory.mockResolvedValue(true);
  });

  it('sendMessage returns 422 when user is missing', async () => {
    const req: any = { user: undefined, body: { content: 'hello', channelId: 'c1' } };
    const res = createRes();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ message: 'User not found' });
  });

  it('sendMessage returns 403 when user is not a channel member', async () => {
    prisma.channelMember.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, body: { content: 'hello', channelId: 'c1' } };
    const res = createRes();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'You are not a member of this channel' });
  });

  it('sendMessage returns 201 on successful send', async () => {
    prisma.channelMember.findFirst.mockResolvedValue({ id: 'cm1' });
    prisma.message.create.mockResolvedValue({ id: 'm1', content: 'hello' });
    const req: any = { user: { id: 'u1' }, body: { content: 'hello', channelId: 'c1' } };
    const res = createRes();

    await sendMessage(req, res);

    expect(prisma.message.create).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Message sent successfully' })
    );
  });

  it('getMessages returns 400 for invalid before cursor', async () => {
    const req: any = {
      user: { id: 'u1' },
      query: { channelId: 'c1', page: '1', limit: '20', before: 'not-a-date' },
    };
    const res = createRes();

    await getMessages(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid before cursor' });
  });

  it('updateMessage returns 404 when message not found', async () => {
    prisma.message.findUnique.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, body: { messageId: 'm1', content: 'updated' } };
    const res = createRes();

    await updateMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Message not found' });
  });

  it('deleteMessage returns 400 when message already deleted', async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: 'm1',
      channelId: 'c1',
      deletedAt: new Date(),
      channel: { workspaceId: 'w1' },
      attachments: [],
    });
    const req: any = { user: { id: 'u1' }, params: { messageId: 'm1' } };
    const res = createRes();

    await deleteMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Message is already deleted' });
  });

  it('reactToMessage returns 400 when reaction already exists', async () => {
    prisma.message.findUnique.mockResolvedValue({ id: 'm1', channelId: 'c1', channel: {} });
    prisma.channelMember.findFirst.mockResolvedValue({ id: 'cm1' });
    prisma.reaction.findUnique.mockResolvedValue({ id: 'r1' });
    const req: any = { user: { id: 'u1' }, body: { messageId: 'm1', emoji: '😀' } };
    const res = createRes();

    await reactToMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'You have already reacted with this emoji' });
  });

  it('removeReaction returns 404 when reaction does not exist', async () => {
    prisma.message.findUnique.mockResolvedValue({ channelId: 'c1' });
    prisma.reaction.findUnique.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, body: { messageId: 'm1', emoji: '😀' } };
    const res = createRes();

    await removeReaction(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Reaction not found' });
  });

  it('getMessage returns 403 when message has neither channel nor conversation', async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: 'm1',
      channelId: null,
      conversationId: null,
      deletedAt: null,
    });
    const req: any = { user: { id: 'u1' }, params: { messageId: 'm1' } };
    const res = createRes();

    await getMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Message has no channel or conversation' });
  });

  it('buildForwardedContent strips html and decodes common entities', () => {
    const result = buildForwardedContent('general', 'alice', '<b>Hello&nbsp;&amp;&lt;team&gt;</b>');
    expect(result).toContain('Forwarded from general by @alice');
    expect(result).toContain('Hello &<team>');
  });

  it('getForwardedMessages returns 403 when user cannot read channel history', async () => {
    collabAccess.canUserReadChannelHistory.mockResolvedValue(false);
    const req: any = { user: { id: 'u1' }, params: { channelId: 'c1' }, query: {} };
    const res = createRes();
    await getForwardedMessages(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('deleteMessage allows admin member to delete others messages', async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: 'm1',
      userId: 'u-owner',
      channelId: 'c1',
      deletedAt: null,
      channel: { workspaceId: 'w1' },
      attachments: [],
    });
    prisma.channelMember.findFirst.mockResolvedValue({ id: 'cm1' });
    prisma.member.findFirst.mockResolvedValue({ role: 'ADMIN' });
    prisma.message.update.mockResolvedValue({ id: 'm1' });

    const req: any = { user: { id: 'u-admin' }, params: { messageId: 'm1' } };
    const res = createRes();
    await deleteMessage(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('getMessage returns 403 when user cannot read conversation history', async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: 'm1',
      channelId: null,
      conversationId: 'cv1',
      deletedAt: null,
    });
    collabAccess.canUserReadConversationHistory.mockResolvedValue(false);
    const req: any = { user: { id: 'u1' }, params: { messageId: 'm1' } };
    const res = createRes();

    await getMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      message: 'You are not a participant in this conversation',
    });
  });

  it('getForwardedMessages returns paginated forwarded messages on success', async () => {
    collabAccess.canUserReadChannelHistory.mockResolvedValue(true);
    prisma.forwardedMessage.findMany.mockResolvedValue([{ id: 'f1' }]);
    prisma.forwardedMessage.count.mockResolvedValue(1);
    const req: any = { user: { id: 'u1' }, params: { channelId: 'c1' }, query: { page: '1', limit: '10' } };
    const res = createRes();

    await getForwardedMessages(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Forwarded messages fetched successfully',
      })
    );
  });
});
