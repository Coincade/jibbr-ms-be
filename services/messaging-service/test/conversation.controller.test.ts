import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  workspace: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  conversation: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  conversationParticipant: { findFirst: vi.fn() },
  message: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
  attachment: { createMany: vi.fn() },
  forwardedMessage: { create: vi.fn() },
  $transaction: vi.fn(async (cb: any) => cb({ conversation: { create: prisma.conversation.create } })),
}));

const helper = vi.hoisted(() => ({
  formatError: vi.fn(() => ({ field: 'invalid' })),
  isFileAttachmentsEnabledForConversation: vi.fn(async () => true),
  canUserSendAttachmentsToConversation: vi.fn(async () => true),
  canUserForwardInTownhall: vi.fn(async () => true),
  isTownhallChannelName: vi.fn(() => false),
}));

const collabAccess = vi.hoisted(() => ({
  findActiveCollaborationBetweenWorkspaces: vi.fn(),
  findActiveGroupContainingBothWorkspaces: vi.fn(),
  isCollaborationDmMutationAllowedForConversation: vi.fn(async () => true),
  canUserReadConversationHistory: vi.fn(async () => true),
}));

const streams = vi.hoisted(() => ({
  publishMessageCreatedEvent: vi.fn(() => Promise.resolve()),
  publishMessageDeletedEvent: vi.fn(() => Promise.resolve()),
}));

const enqueueMembershipOutboxEvent = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('../src/helper.js', () => helper);
vi.mock('../src/config/upload.js', () => ({ uploadToSpaces: vi.fn(), deleteFromSpaces: vi.fn() }));
vi.mock('../src/services/streams-publisher.service.js', () => streams);
vi.mock('../src/services/membership-outbox.service.js', () => ({ enqueueMembershipOutboxEvent }));
vi.mock('../src/helpers/collaborationAccess.js', () => collabAccess);
vi.mock('../src/controllers/message.controller.js', () => ({ buildForwardedContent: vi.fn(() => 'fwd') }));
vi.mock('../src/libs/htmlToCleanText.js', () => ({ htmlToCleanText: vi.fn((s: string) => s) }));

import {
  deleteDirectMessage,
  getConversationMessages,
  getOrCreateConversation,
  getUserConversations,
  sendDirectMessage,
} from '../src/controllers/conversation.controller.js';

function createRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('conversation.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collabAccess.findActiveCollaborationBetweenWorkspaces.mockResolvedValue(null);
    collabAccess.findActiveGroupContainingBothWorkspaces.mockResolvedValue(null);
  });

  it('getOrCreateConversation returns 400 when targetUserId missing', async () => {
    const req: any = { user: { id: 'u1' }, params: {}, query: { workspaceId: 'w1' } };
    const res = createRes();
    await getOrCreateConversation(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('getOrCreateConversation returns 403 when requester not workspace member', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ members: [] });
    const req: any = { user: { id: 'u1' }, params: { targetUserId: 'u2' }, query: { workspaceId: 'w1' } };
    const res = createRes();
    await getOrCreateConversation(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('sendDirectMessage returns 400 when content missing', async () => {
    const req: any = { user: { id: 'u1' }, params: { conversationId: 'cv1' }, body: {} };
    const res = createRes();
    await sendDirectMessage(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('getConversationMessages returns 400 for invalid before cursor', async () => {
    const req: any = { user: { id: 'u1' }, params: { conversationId: 'cv1' }, query: { before: 'bad' } };
    const res = createRes();
    await getConversationMessages(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('deleteDirectMessage returns 404 when message does not exist', async () => {
    prisma.message.findUnique.mockResolvedValue(null);
    const req: any = {
      user: { id: 'u1' },
      params: { conversationId: 'cv1', messageId: 'm1' },
    };
    const res = createRes();
    await deleteDirectMessage(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('getOrCreateConversation returns 404 when workspace does not exist', async () => {
    prisma.workspace.findUnique.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { targetUserId: 'u2' }, query: { workspaceId: 'w1' } };
    const res = createRes();
    await getOrCreateConversation(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('sendDirectMessage returns 403 when user is not participant', async () => {
    prisma.conversationParticipant.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { conversationId: 'cv1' }, body: { content: 'hello' } };
    const res = createRes();
    await sendDirectMessage(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('getUserConversations returns 200 with mapped response', async () => {
    prisma.conversation.findMany.mockResolvedValue([
      {
        id: 'cv1',
        workspaceId: 'w1',
        participants: [
          { id: 'p1', userId: 'u1', isActive: true, createdAt: new Date(), updatedAt: new Date(), user: { id: 'u1' } },
          { id: 'p2', userId: 'u2', isActive: true, createdAt: new Date(), updatedAt: new Date(), user: { id: 'u2' } },
        ],
        messages: [],
      },
    ]);
    collabAccess.canUserReadConversationHistory.mockResolvedValue(true);
    const req: any = { user: { id: 'u1' }, query: {} };
    const res = createRes();
    await getUserConversations(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
