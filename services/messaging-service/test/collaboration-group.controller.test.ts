import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  collaborationPolicy: { create: vi.fn() },
  collaborationGroup: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  collaborationGroupMembership: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  collaborationGroupAuditLog: { create: vi.fn() },
  workspace: { findFirst: vi.fn(), findUnique: vi.fn() },
  channel: { create: vi.fn() },
  member: { findMany: vi.fn() },
  $transaction: vi.fn(async (cb: any) => cb({
    collaborationGroupMembership: { update: prisma.collaborationGroupMembership.update },
    channel: { create: prisma.channel.create },
  })),
}));

const helper = vi.hoisted(() => ({ formatError: vi.fn(() => ({ field: 'invalid' })) }));
const isWorkspaceAdmin = vi.hoisted(() => vi.fn(async () => false));
const cleanupGroupMembershipArtifacts = vi.hoisted(() => vi.fn(async () => {}));
const streams = vi.hoisted(() => ({
  publishChannelEvent: vi.fn(() => Promise.resolve()),
  publishCollaborationInvalidate: vi.fn(() => Promise.resolve()),
}));
const NotificationService = vi.hoisted(() => ({ notifyCollaborationAdmins: vi.fn(() => Promise.resolve()) }));
const enqueueMembershipOutboxEvent = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('../src/helper.js', () => helper);
vi.mock('../src/helpers/collaborationAccess.js', () => ({ isWorkspaceAdmin }));
vi.mock('../src/helpers/collaborationRevokeCleanup.js', () => ({ cleanupGroupMembershipArtifacts }));
vi.mock('../src/services/streams-publisher.service.js', () => streams);
vi.mock('../src/services/notification.service.js', () => ({ NotificationService }));
vi.mock('../src/services/membership-outbox.service.js', () => ({ enqueueMembershipOutboxEvent }));

import {
  acceptGroupInvite,
  createGroup,
  createGroupSharedChannel,
  getGroup,
  inviteWorkspace,
  listGroups,
  rejectGroupInvite,
  revokeGroupMembership,
} from '../src/controllers/collaboration-group.controller.js';

function createRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('collaboration-group.controller', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createGroup returns 403 when caller is not workspace admin', async () => {
    const req: any = { user: { id: 'u1' }, body: { name: 'Group', ownerWorkspaceId: 'w1' } };
    const res = createRes();
    await createGroup(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('inviteWorkspace returns 404 when group not found', async () => {
    prisma.collaborationGroup.findFirst.mockResolvedValue(null);
    const req: any = {
      user: { id: 'u1' },
      params: { id: 'g1' },
      body: { targetWorkspaceSlug: 'acme', workspaceId: 'w1' },
    };
    const res = createRes();
    await inviteWorkspace(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('acceptGroupInvite returns 404 when no pending invite exists', async () => {
    isWorkspaceAdmin.mockResolvedValue(true);
    prisma.collaborationGroupMembership.findUnique.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { id: 'g1' }, body: { workspaceId: 'w2' } };
    const res = createRes();
    await acceptGroupInvite(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('acceptGroupInvite activates the membership and invalidates related workspaces', async () => {
    isWorkspaceAdmin.mockResolvedValue(true);
    prisma.collaborationGroupMembership.findUnique.mockResolvedValue({
      id: 'm1',
      status: 'INVITED',
    });
    prisma.collaborationGroupMembership.update.mockResolvedValue({ id: 'm1', status: 'ACTIVE' });
    prisma.collaborationGroup.findUnique.mockResolvedValue({ name: 'Partners' });
    prisma.collaborationGroupMembership.findFirst.mockResolvedValue({ workspaceId: 'owner-ws' });
    prisma.workspace.findUnique.mockResolvedValue({ name: 'Joined Workspace' });
    prisma.collaborationGroupMembership.findMany.mockResolvedValue([
      { workspaceId: 'owner-ws' },
      { workspaceId: 'w2' },
    ]);

    const req: any = { user: { id: 'u1' }, params: { id: 'g1' }, body: { workspaceId: 'w2' } };
    const res = createRes();

    await acceptGroupInvite(req, res);

    expect(prisma.collaborationGroupMembership.update).toHaveBeenCalled();
    expect(prisma.collaborationGroupAuditLog.create).toHaveBeenCalled();
    expect(NotificationService.notifyCollaborationAdmins).toHaveBeenCalled();
    expect(streams.publishCollaborationInvalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceIds: expect.arrayContaining(['owner-ws', 'w2']),
        reason: 'group_invite_accepted',
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejectGroupInvite returns 403 when the caller is not a workspace admin', async () => {
    isWorkspaceAdmin.mockResolvedValue(false);
    const req: any = { user: { id: 'u1' }, params: { id: 'g1' }, body: { workspaceId: 'w2' } };
    const res = createRes();
    await rejectGroupInvite(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejectGroupInvite revokes a pending invitation', async () => {
    isWorkspaceAdmin.mockResolvedValue(true);
    prisma.collaborationGroupMembership.findUnique.mockResolvedValue({ id: 'mem1', status: 'INVITED' });
    prisma.collaborationGroupMembership.update.mockResolvedValue({ id: 'mem1', status: 'REVOKED' });
    prisma.collaborationGroupMembership.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { id: 'g1' }, body: { workspaceId: 'w2' } };
    const res = createRes();
    await rejectGroupInvite(req, res);
    expect(prisma.collaborationGroupMembership.update).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('revokeGroupMembership returns 400 when ids are missing', async () => {
    const req: any = { user: { id: 'u1' }, params: { id: ' ', workspaceId: '' } };
    const res = createRes();
    await revokeGroupMembership(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('revokeGroupMembership returns 404 when the group has no owner', async () => {
    prisma.collaborationGroupMembership.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { id: 'g1', workspaceId: 'w2' } };
    const res = createRes();
    await revokeGroupMembership(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Group not found' });
  });

  it('listGroups returns groups for the caller workspaces', async () => {
    prisma.member.findMany.mockResolvedValue([{ workspaceId: 'w1' }]);
    prisma.collaborationGroup.findMany.mockResolvedValue([{ id: 'g1' }]);
    const req: any = { user: { id: 'u1' } };
    const res = createRes();
    await listGroups(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('getGroup returns 404 when the group does not exist', async () => {
    prisma.member.findMany.mockResolvedValue([{ workspaceId: 'w1' }]);
    prisma.collaborationGroup.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { id: 'g1' } };
    const res = createRes();
    await getGroup(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('getGroup returns the group when the caller workspace is a member', async () => {
    prisma.member.findMany.mockResolvedValue([{ workspaceId: 'w1' }]);
    prisma.collaborationGroup.findFirst.mockResolvedValue({
      id: 'g1',
      memberships: [{ workspaceId: 'w1', status: 'ACTIVE' }],
    });
    const req: any = { user: { id: 'u1' }, params: { id: 'g1' } };
    const res = createRes();
    await getGroup(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('createGroupSharedChannel returns 404 when the group is not active', async () => {
    prisma.collaborationGroup.findFirst.mockResolvedValue(null);
    const req: any = {
      user: { id: 'u1' },
      params: { id: 'g1' },
      body: { name: 'shared', ownerWorkspaceId: 'w1' },
    };
    const res = createRes();
    await createGroupSharedChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('createGroupSharedChannel returns 403 when the policy disables shared channels', async () => {
    prisma.collaborationGroup.findFirst.mockResolvedValue({
      id: 'g1',
      policy: { allowSharedChannels: false },
      memberships: [{ workspaceId: 'w1', role: 'OWNER' }],
    });
    const req: any = {
      user: { id: 'u1' },
      params: { id: 'g1' },
      body: { name: 'shared', ownerWorkspaceId: 'w1' },
    };
    const res = createRes();
    await createGroupSharedChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
