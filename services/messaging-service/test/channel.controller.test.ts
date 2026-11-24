import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  member: { findFirst: vi.fn(), findMany: vi.fn() },
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
  acceptBridgeInvite,
  addMemberToChannel,
  checkInviteEmailRegistered,
  createChannel,
  createBridgeChannel,
  getBridgeChannels,
  getChannel,
  getWorkspaceChannels,
  hardDeleteChannel,
  inviteToBridgeChannel,
  joinChannel,
  removeMemberFromChannel,
  softDeleteChannel,
  updateChannel,
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

  it('getChannel returns 404 when the channel does not exist', async () => {
    prisma.channel.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { id: 'c1' } };
    const res = createRes();
    await getChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Channel not found' });
  });

  it('getChannel returns 403 when the user is not a channel member', async () => {
    prisma.channel.findFirst.mockResolvedValue({
      id: 'c1',
      workspaceId: 'w1',
      isBridgeChannel: false,
      collaborationId: null,
      groupId: null,
      members: [],
    });
    prisma.member.findFirst.mockResolvedValue({ id: 'm1' });
    const req: any = { user: { id: 'u1' }, params: { id: 'c1' } };
    const res = createRes();
    await getChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'You are not a member of this channel' });
  });

  it('addMemberToChannel returns 404 when the channel does not exist', async () => {
    prisma.channel.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, body: { userId: 'u2', channelId: 'c1' } };
    const res = createRes();
    await addMemberToChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('addMemberToChannel returns 422 when the requester is missing', async () => {
    const req: any = { user: undefined, body: { userId: 'u2', channelId: 'c1' } };
    const res = createRes();
    await addMemberToChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('addMemberToChannel lets a non-admin member add someone from another network workspace', async () => {
    prisma.channel.findFirst.mockResolvedValue({
      id: 'c1',
      workspaceId: 'w1',
      isBridgeChannel: false,
      collaborationId: null,
      groupId: 'g1',
      channelAdminId: 'someone-else',
    });
    prisma.channelMember.findFirst.mockReset();
    prisma.channelMember.findFirst
      .mockResolvedValueOnce({ id: 'cm-self' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.collaborationGroupMembership.findMany.mockResolvedValue([
      { workspaceId: 'w1' },
      { workspaceId: 'w2' },
    ]);
    prisma.member.findMany.mockResolvedValue([{ workspaceId: 'w2' }]);
    prisma.channelMember.create.mockResolvedValue({ id: 'cm-new', userId: 'u-admin', channelId: 'c1' });
    isWorkspaceAdmin.mockResolvedValue(false);

    const req: any = { user: { id: 'u-member' }, body: { userId: 'u-admin', channelId: 'c1' } };
    const res = createRes();
    await addMemberToChannel(req, res);

    expect(isWorkspaceAdmin).not.toHaveBeenCalled();
    expect(prisma.channelMember.create).toHaveBeenCalledWith({
      data: { userId: 'u-admin', channelId: 'c1', isExternal: true },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('addMemberToChannel lets a non-admin member add someone from a partner workspace', async () => {
    prisma.channel.findFirst.mockResolvedValue({
      id: 'c1',
      workspaceId: 'w1',
      isBridgeChannel: false,
      collaborationId: 'link-1',
      groupId: null,
      channelAdminId: 'someone-else',
    });
    prisma.channelMember.findFirst.mockReset();
    prisma.channelMember.findFirst
      .mockResolvedValueOnce({ id: 'cm-self' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.workspaceCollaboration.findFirst.mockResolvedValue({
      id: 'link-1',
      status: 'ACTIVE',
      workspaceAId: 'w1',
      workspaceBId: 'w2',
      policy: { allowSharedChannels: true },
    });
    prisma.member.findMany.mockResolvedValue([{ workspaceId: 'w2' }]);
    prisma.channelMember.create.mockResolvedValue({ id: 'cm-new', userId: 'u-mod', channelId: 'c1' });

    const req: any = { user: { id: 'u-member' }, body: { userId: 'u-mod', channelId: 'c1' } };
    const res = createRes();
    await addMemberToChannel(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.channelMember.create).toHaveBeenCalledWith({
      data: { userId: 'u-mod', channelId: 'c1', isExternal: true },
    });
  });

  it('addMemberToChannel still blocks a non-admin member from adding people to a bridge channel', async () => {
    prisma.channel.findFirst.mockResolvedValue({
      id: 'c1',
      workspaceId: 'w1',
      isBridgeChannel: true,
      collaborationId: null,
      groupId: null,
      channelAdminId: 'owner',
    });
    prisma.channelMember.findFirst.mockResolvedValue({ id: 'cm-self' });
    isWorkspaceAdmin.mockResolvedValue(false);

    const req: any = { user: { id: 'u-member' }, body: { userId: 'u2', channelId: 'c1' } };
    const res = createRes();
    await addMemberToChannel(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.channelMember.create).not.toHaveBeenCalled();
  });

  it('removeMemberFromChannel returns 404 when the target is not a member', async () => {
    prisma.channel.findFirst.mockResolvedValue({ id: 'c1', workspaceId: 'w1', channelAdminId: 'owner' });
    prisma.channelMember.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { channelId: 'c1' }, body: { userId: 'u2' } };
    const res = createRes();
    await removeMemberFromChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'User is not a member of this channel' });
  });

  it('removeMemberFromChannel returns 400 when the creator tries to leave', async () => {
    prisma.channel.findFirst.mockResolvedValue({ id: 'c1', workspaceId: 'w1', channelAdminId: 'u1' });
    prisma.channelMember.findFirst.mockResolvedValue({ id: 'cm1', userId: 'u1' });
    const req: any = { user: { id: 'u1' }, params: { channelId: 'c1' }, body: { userId: 'u1' } };
    const res = createRes();
    await removeMemberFromChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('updateChannel returns 404 when the channel does not exist', async () => {
    prisma.channel.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { id: 'c1' }, body: { name: 'renamed' } };
    const res = createRes();
    await updateChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('updateChannel updates the channel for a workspace admin', async () => {
    prisma.channel.findFirst.mockResolvedValue({
      id: 'c1',
      workspaceId: 'w1',
      channelAdminId: 'owner',
    });
    prisma.member.findFirst.mockResolvedValue({ role: 'ADMIN' });
    prisma.channel.update.mockResolvedValue({ id: 'c1', name: 'renamed' });
    const req: any = { user: { id: 'u1' }, params: { id: 'c1' }, body: { name: 'renamed' } };
    const res = createRes();
    await updateChannel(req, res);
    expect(prisma.channel.update).toHaveBeenCalled();
    expect(publishChannelEvent).toHaveBeenCalledWith('channel.updated', { id: 'c1', name: 'renamed' });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('inviteToBridgeChannel returns 404 when the bridge channel is missing', async () => {
    prisma.channel.findFirst.mockResolvedValue(null);
    const req: any = {
      user: { id: 'u1' },
      params: { channelId: 'c1' },
      body: { inviteeEmail: 'guest@example.com' },
    };
    const res = createRes();
    await inviteToBridgeChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Bridge channel not found' });
  });

  it('inviteToBridgeChannel returns 403 when the requester is not the creator', async () => {
    prisma.channel.findFirst.mockResolvedValue({ id: 'c1', channelAdminId: 'owner' });
    const req: any = {
      user: { id: 'u1' },
      params: { channelId: 'c1' },
      body: { inviteeEmail: 'guest@example.com' },
    };
    const res = createRes();
    await inviteToBridgeChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('acceptBridgeInvite returns 400 for an invalid token', async () => {
    prisma.channelInvite.findFirst.mockResolvedValue(null);
    const req: any = { body: { token: 'missing' } };
    const res = createRes();
    await acceptBridgeInvite(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('acceptBridgeInvite returns 400 when the invitee has no account', async () => {
    prisma.channelInvite.findFirst.mockResolvedValue({
      id: 'inv1',
      inviteeEmail: 'guest@example.com',
      channelId: 'c1',
    });
    prisma.user.findUnique.mockResolvedValue(null);
    const req: any = { body: { token: 'tok' } };
    const res = createRes();
    await acceptBridgeInvite(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Create an account first' })
    );
  });

  it('getBridgeChannels returns 422 when the user is missing', async () => {
    const req: any = { user: undefined };
    const res = createRes();
    await getBridgeChannels(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('getBridgeChannels returns the caller bridge channels', async () => {
    prisma.channel.findMany.mockResolvedValue([{ id: 'c1' }]);
    const req: any = { user: { id: 'u1' } };
    const res = createRes();
    await getBridgeChannels(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Bridge channels fetched successfully' })
    );
  });
});
