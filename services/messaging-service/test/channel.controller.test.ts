import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  member: { findFirst: vi.fn() },
  channel: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
  channelMember: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  collaborationGroup: { findFirst: vi.fn() },
  workspace: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
  channelInvite: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(async (cb: any) =>
    cb({
      channelMember: {
        create: prisma.channelMember.create,
        update: prisma.channelMember.update,
        updateMany: prisma.channelMember.updateMany,
      },
      channelInvite: { update: prisma.channelInvite.update },
    })
  ),
  reaction: { deleteMany: vi.fn() },
  attachment: { deleteMany: vi.fn() },
  forwardedMessage: { deleteMany: vi.fn() },
  message: { deleteMany: vi.fn(), findMany: vi.fn() },
  workspaceCollaboration: { findFirst: vi.fn() },
  collaborationGroupMembership: { findMany: vi.fn() },
}));

const helper = vi.hoisted(() => ({
  formatError: vi.fn(() => ({ field: 'invalid' })),
  canUserSendAttachmentsToChannel: vi.fn(async () => true),
}));
const publishChannelEvent = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const enqueueMembershipOutboxEvent = vi.hoisted(() => vi.fn(async () => {}));
const isWorkspaceAdmin = vi.hoisted(() => vi.fn(async () => false));

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('../src/helper.js', () => helper);
vi.mock('../src/services/streams-publisher.service.js', () => ({ publishChannelEvent }));
vi.mock('../src/services/membership-outbox.service.js', () => ({ enqueueMembershipOutboxEvent }));
vi.mock('../src/helpers/collaborationAccess.js', () => ({ isWorkspaceAdmin }));

import {
  checkInviteEmailRegistered,
  createChannel,
  createBridgeChannel,
  getWorkspaceChannels,
  hardDeleteChannel,
  joinChannel,
  softDeleteChannel,
} from '../src/controllers/channel.controller.js';

function createRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('channel.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DELETE_PASS = 'secret';
  });

  it('createChannel returns 403 when user is not workspace member', async () => {
    prisma.member.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, body: { name: 'gen', type: 'PUBLIC', workspaceId: 'w1' } };
    const res = createRes();
    await createChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('getWorkspaceChannels returns 403 when user is not workspace member', async () => {
    prisma.member.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { workspaceId: 'w1' } };
    const res = createRes();
    await getWorkspaceChannels(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('joinChannel returns 404 when channel does not exist', async () => {
    prisma.channel.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, body: { channelId: 'c1' } };
    const res = createRes();
    await joinChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('softDeleteChannel returns 404 when channel not found', async () => {
    prisma.channel.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { id: 'c1' } };
    const res = createRes();
    await softDeleteChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('createChannel returns 404 when provided group is not active', async () => {
    prisma.member.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.collaborationGroup.findFirst.mockResolvedValue(null);
    const req: any = {
      user: { id: 'u1' },
      body: { name: 'gen', type: 'PUBLIC', workspaceId: 'w1', groupId: 'g1' },
    };
    const res = createRes();
    await createChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('createChannel returns 201 and publishes event on success', async () => {
    prisma.member.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.channel.create.mockResolvedValue({ id: 'c1', name: 'gen' });
    const req: any = { user: { id: 'u1' }, body: { name: 'gen', type: 'PUBLIC', workspaceId: 'w1' } };
    const res = createRes();
    await createChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(publishChannelEvent).toHaveBeenCalledWith('channel.created', expect.objectContaining({ id: 'c1' }));
  });

  it('joinChannel returns 400 when already active member', async () => {
    prisma.channel.findFirst.mockResolvedValue({ id: 'c1', workspaceId: 'w1' });
    prisma.member.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.channelMember.findFirst.mockResolvedValueOnce({ id: 'cm1', isActive: true });
    const req: any = { user: { id: 'u1' }, body: { channelId: 'c1' } };
    const res = createRes();
    await joinChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('joinChannel reactivates inactive membership and enqueues outbox event', async () => {
    prisma.channel.findFirst.mockResolvedValue({ id: 'c1', workspaceId: 'w1' });
    prisma.member.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.channelMember.findFirst
      .mockResolvedValueOnce(null) // existing active
      .mockResolvedValueOnce({ id: 'cm-old', isActive: false }); // previously removed
    prisma.channelMember.updateMany.mockResolvedValue({ count: 1 });
    const req: any = { user: { id: 'u1' }, body: { channelId: 'c1' } };
    const res = createRes();
    await joinChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(enqueueMembershipOutboxEvent).toHaveBeenCalled();
  });

  it('softDeleteChannel returns 403 when user lacks permissions', async () => {
    prisma.channel.findFirst.mockResolvedValue({ id: 'c1', workspaceId: 'w1', channelAdminId: 'other' });
    prisma.member.findFirst.mockResolvedValue({ role: 'MEMBER' });
    const req: any = { user: { id: 'u1' }, params: { id: 'c1' } };
    const res = createRes();
    await softDeleteChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('hardDeleteChannel rejects invalid delete password', async () => {
    const req: any = { user: { id: 'u1' }, params: { id: 'c1' }, body: { DELETE_PASS: 'bad' } };
    const res = createRes();
    await hardDeleteChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('checkInviteEmailRegistered returns false when auth service url is not configured', async () => {
    delete process.env.AUTH_SERVICE_URL;
    delete process.env.AUTH_API_URL;
    const req: any = { query: { email: 'x@y.com' } };
    const res = createRes();
    await checkInviteEmailRegistered(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ registered: false });
  });

  it('createBridgeChannel returns 403 when requester is not workspace admin', async () => {
    prisma.workspace.findFirst.mockResolvedValue({ id: 'w1', userId: 'owner' });
    prisma.member.findFirst.mockResolvedValue({ role: 'MEMBER' });
    const req: any = { user: { id: 'u1' }, body: { name: 'bridge', workspaceId: 'w1' } };
    const res = createRes();
    await createBridgeChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
