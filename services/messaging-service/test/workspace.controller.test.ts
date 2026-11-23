import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  workspace: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  member: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
  channel: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  channelMember: { createMany: vi.fn(), deleteMany: vi.fn() },
  reaction: { deleteMany: vi.fn() },
  attachment: { deleteMany: vi.fn() },
  forwardedMessage: { deleteMany: vi.fn() },
  message: { deleteMany: vi.fn() },
  conversationReadStatus: { deleteMany: vi.fn() },
  conversationParticipant: { deleteMany: vi.fn() },
  conversation: { deleteMany: vi.fn() },
  $transaction: vi.fn(async (cb: any) =>
    cb({
      channelMember: { createMany: prisma.channelMember.createMany },
      channel: { findMany: prisma.channel.findMany },
      member: { create: prisma.member.create, update: prisma.member.update },
    })
  ),
}));

const formatError = vi.hoisted(() => vi.fn(() => ({ field: 'invalid' })));
const generateCode = vi.hoisted(() => vi.fn(() => 'ABC123'));
const getEmailDomain = vi.hoisted(() => vi.fn((email: string) => email.split('@')[1] || null));
const publishWorkspaceEvent = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const canAccessWorkspaceResource = vi.hoisted(() => vi.fn(async () => true));
const enqueueMembershipOutboxEvent = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../src/helper.js', () => ({ formatError }));
vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('../src/helpers/generateCode.js', () => ({ default: generateCode }));
vi.mock('../src/helpers/domainUtils.js', () => ({ getEmailDomain }));
vi.mock('../src/services/streams-publisher.service.js', () => ({ publishWorkspaceEvent }));
vi.mock('../src/helpers/collaborationAccess.js', () => ({ canAccessWorkspaceResource }));
vi.mock('../src/services/membership-outbox.service.js', () => ({ enqueueMembershipOutboxEvent }));
vi.mock('../src/helpers/collaborationRevokeCleanup.js', () => ({
  cleanupUserLeavingWorkspace: vi.fn(async () => {}),
}));

import {
  createWorkspace,
  getAllWorkspaces,
  getAllWorkspacesForUser,
  getPublicChannels,
  getWorkspace,
  getWorkspaceMembers,
  hardDeleteWorkspace,
  joinWorkspace,
  joinWorkspaceByCode,
  leaveWorkspace,
  softDeleteWorkspace,
  updateMemberRole,
  updateWorkspace,
} from '../src/controllers/workspace.controller.js';

function createRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('workspace.controller', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createWorkspace returns 400 when domain workspace already exists', async () => {
    prisma.workspace.findFirst.mockResolvedValue({ id: 'w-existing' });
    const req: any = { user: { id: 'u1', email: 'a@org.com' }, body: { name: 'Org' } };
    const res = createRes();
    await createWorkspace(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('joinWorkspaceByCode returns validation error for invalid join code payload', async () => {
    prisma.workspace.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1', email: 'a@org.com' }, body: { joinCode: 'XYZ' } };
    const res = createRes();
    await joinWorkspaceByCode(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('updateWorkspace returns 400 when name is missing', async () => {
    const req: any = { user: { id: 'u1' }, params: { id: 'w1' }, body: {} };
    const res = createRes();
    await updateWorkspace(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('updateWorkspace returns 403 when requester has no admin permission', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ id: 'w1', userId: 'owner' });
    prisma.member.findFirst.mockResolvedValue({ role: 'MEMBER' });
    const req: any = { user: { id: 'u1' }, params: { id: 'w1' }, body: { name: 'New' } };
    const res = createRes();
    await updateWorkspace(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('createWorkspace returns 201 on successful creation flow', async () => {
    prisma.workspace.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    prisma.workspace.create.mockResolvedValue({ id: 'w1', joinCode: 'ABC123' });
    prisma.member.create.mockResolvedValue({ id: 'm1' });
    prisma.channel.create
      .mockResolvedValueOnce({ id: 'c-general' })
      .mockResolvedValueOnce({ id: 'c-townhall' });

    const req: any = { user: { id: 'u1', email: 'a@org.com' }, body: { name: 'Org' } };
    const res = createRes();
    await createWorkspace(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(publishWorkspaceEvent).toHaveBeenCalledWith('workspace.created', expect.objectContaining({ id: 'w1' }));
    expect(enqueueMembershipOutboxEvent).toHaveBeenCalledTimes(2);
  });

  it('joinWorkspaceByCode returns 200 when joining valid domain workspace', async () => {
    prisma.workspace.findFirst.mockResolvedValue({
      id: 'w1',
      user: { email: 'owner@org.com' },
    });
    prisma.member.findFirst.mockResolvedValue(null);
    prisma.channel.findMany.mockResolvedValue([{ id: 'c1' }]);
    const req: any = { user: { id: 'u1', email: 'a@org.com' }, body: { joinCode: '123456' } };
    const res = createRes();
    await joinWorkspaceByCode(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('softDeleteWorkspace returns 403 for non-admin and non-creator', async () => {
    prisma.workspace.findFirst.mockResolvedValue({ id: 'w1', userId: 'owner' });
    prisma.member.findFirst.mockResolvedValue({ role: 'MEMBER' });
    const req: any = { user: { id: 'u1' }, params: { id: 'w1' } };
    const res = createRes();
    await softDeleteWorkspace(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('hardDeleteWorkspace rejects invalid delete password', async () => {
    process.env.DELETE_PASS = 'secret';
    const req: any = { user: { id: 'u1' }, params: { id: 'w1' }, body: { DELETE_PASS: 'bad' } };
    const res = createRes();
    await hardDeleteWorkspace(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('getAllWorkspaces returns 422 when the user is missing', async () => {
    const req: any = { user: undefined };
    const res = createRes();
    await getAllWorkspaces(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('getAllWorkspaces returns active workspaces', async () => {
    prisma.workspace.findMany.mockResolvedValue([{ id: 'w1' }]);
    const req: any = { user: { id: 'u1' } };
    const res = createRes();
    await getAllWorkspaces(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Workspaces fetched successfully' })
    );
  });

  it('getWorkspace returns the workspace payload', async () => {
    prisma.workspace.findFirst.mockResolvedValue({ id: 'w1' });
    const req: any = { user: { id: 'u1' }, params: { id: 'w1' } };
    const res = createRes();
    await getWorkspace(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('getAllWorkspacesForUser returns an empty list when the user has none', async () => {
    prisma.workspace.findMany.mockResolvedValue([]);
    prisma.workspace.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1', email: 'a@org.com' } };
    const res = createRes();
    await getAllWorkspacesForUser(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('getWorkspaceMembers returns 403 when the caller cannot access the workspace', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ id: 'w1' });
    canAccessWorkspaceResource.mockResolvedValue(false);
    const req: any = { user: { id: 'u1' }, params: { id: 'w1' } };
    const res = createRes();
    await getWorkspaceMembers(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('getWorkspaceMembers returns members the caller can see', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ id: 'w1' });
    canAccessWorkspaceResource.mockResolvedValue(true);
    prisma.member.findMany.mockResolvedValue([{ id: 'm1' }]);
    const req: any = { user: { id: 'u1' }, params: { id: 'w1' } };
    const res = createRes();
    await getWorkspaceMembers(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('joinWorkspace returns 422 when the workspace or code does not match', async () => {
    prisma.workspace.findUnique.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { id: 'w1' }, body: { joinCode: '123456' } };
    const res = createRes();
    await joinWorkspace(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Workspace not found' })
    );
  });

  it('joinWorkspace creates a member when the code matches', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ id: 'w1' });
    prisma.member.findFirst.mockResolvedValue(null);
    prisma.member.create.mockResolvedValue({ id: 'm1' });
    prisma.channel.findMany.mockResolvedValue([]);
    const req: any = { user: { id: 'u1' }, params: { id: 'w1' }, body: { joinCode: '123456' } };
    const res = createRes();
    await joinWorkspace(req, res);
    expect(prisma.member.create).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('leaveWorkspace returns 422 when the caller is not a member', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ id: 'w1' });
    prisma.member.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { id: 'w1' } };
    const res = createRes();
    await leaveWorkspace(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ message: 'Member not found' });
  });

  it('leaveWorkspace deactivates the membership', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ id: 'w1' });
    prisma.member.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.member.update.mockResolvedValue({});
    const req: any = { user: { id: 'u1' }, params: { id: 'w1' } };
    const res = createRes();
    await leaveWorkspace(req, res);
    expect(prisma.member.update).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('getPublicChannels returns 422 when the workspace is missing', async () => {
    prisma.workspace.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { id: 'w1' } };
    const res = createRes();
    await getPublicChannels(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('getPublicChannels returns public channels for a member', async () => {
    prisma.workspace.findFirst.mockResolvedValue({ id: 'w1' });
    prisma.member.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.channel.findMany.mockResolvedValue([{ id: 'c1', name: 'general' }]);
    const req: any = { user: { id: 'u1' }, params: { id: 'w1' } };
    const res = createRes();
    await getPublicChannels(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('updateMemberRole returns 400 for an unknown role', async () => {
    const req: any = { user: { id: 'u1' }, params: { id: 'w1', memberId: 'm2' }, body: { role: 'OWNER' } };
    const res = createRes();
    await updateMemberRole(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('updateMemberRole returns 403 when the caller is not an admin', async () => {
    prisma.workspace.findFirst.mockResolvedValue({ id: 'w1', userId: 'owner' });
    prisma.member.findFirst.mockResolvedValue({ role: 'MEMBER' });
    const req: any = { user: { id: 'u1' }, params: { id: 'w1', memberId: 'm2' }, body: { role: 'ADMIN' } };
    const res = createRes();
    await updateMemberRole(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
