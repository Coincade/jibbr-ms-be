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
  inviteWorkspace,
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
});
