import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  workspace: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  workspaceCollaborationRequest: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  workspaceCollaboration: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
  collaborationPolicy: { create: vi.fn() },
  member: { findMany: vi.fn() },
  collaborationAuditLog: { create: vi.fn() },
  channel: { create: vi.fn() },
  conversation: { findFirst: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(async (cb: any) => cb({
    workspaceCollaboration: { update: prisma.workspaceCollaboration.update },
    workspaceCollaborationRequest: { updateMany: vi.fn() },
    channel: { create: prisma.channel.create },
    conversation: { create: prisma.conversation.create },
  })),
}));

const helper = vi.hoisted(() => ({ formatError: vi.fn(() => ({ field: 'invalid' })) }));
const collabAccess = vi.hoisted(() => ({
  canAccessWorkspaceResource: vi.fn(async () => true),
  findActiveCollaborationBetweenWorkspaces: vi.fn(),
  isWorkspaceAdmin: vi.fn(async () => false),
}));
const cleanupPairwiseCollaborationArtifacts = vi.hoisted(() => vi.fn(async () => {}));
const streams = vi.hoisted(() => ({
  publishChannelEvent: vi.fn(() => Promise.resolve()),
  publishCollaborationInvalidate: vi.fn(() => Promise.resolve()),
}));
const NotificationService = vi.hoisted(() => ({
  notifyCollaborationAdmins: vi.fn(() => Promise.resolve()),
}));
const enqueueMembershipOutboxEvent = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('../src/helper.js', () => helper);
vi.mock('../src/helpers/collaborationAccess.js', () => collabAccess);
vi.mock('../src/helpers/collaborationRevokeCleanup.js', () => ({ cleanupPairwiseCollaborationArtifacts }));
vi.mock('../src/services/streams-publisher.service.js', () => streams);
vi.mock('../src/services/notification.service.js', () => ({ NotificationService }));
vi.mock('../src/services/membership-outbox.service.js', () => ({ enqueueMembershipOutboxEvent }));

import {
  approveCollaborationRequest,
  createCollaborationRequest,
  createExternalDirectMessage,
  createSharedChannel,
  revokeCollaborationLink,
} from '../src/controllers/workspace-collaboration.controller.js';

function createRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('workspace-collaboration.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collabAccess.findActiveCollaborationBetweenWorkspaces.mockResolvedValue(null);
    prisma.workspace.findMany.mockResolvedValue([]);
  });

  it('createCollaborationRequest returns 404 when target workspace is not found', async () => {
    prisma.workspace.findFirst.mockResolvedValue(null);
    const req: any = {
      user: { id: 'u1' },
      body: { requestingWorkspaceId: 'w1', targetWorkspaceSlug: 'missing' },
    };
    const res = createRes();
    await createCollaborationRequest(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('approveCollaborationRequest returns 404 when request not found', async () => {
    prisma.workspaceCollaborationRequest.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { id: 'r1' } };
    const res = createRes();
    await approveCollaborationRequest(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('revokeCollaborationLink returns 404 when active link not found', async () => {
    prisma.workspaceCollaboration.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { id: 'l1' } };
    const res = createRes();
    await revokeCollaborationLink(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('approveCollaborationRequest returns 400 when request is not pending', async () => {
    prisma.workspaceCollaborationRequest.findFirst.mockResolvedValue({
      id: 'r1',
      status: 'ACCEPTED',
      targetWorkspaceId: 'w2',
    });
    const req: any = { user: { id: 'u1' }, params: { id: 'r1' } };
    const res = createRes();
    await approveCollaborationRequest(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createSharedChannel returns 403 when policy disallows shared channels', async () => {
    prisma.workspaceCollaboration.findFirst.mockResolvedValue({
      id: 'l1',
      status: 'ACTIVE',
      workspaceAId: 'w1',
      workspaceBId: 'w2',
      policy: { allowSharedChannels: false },
    });
    const req: any = {
      user: { id: 'u1' },
      params: { id: 'l1' },
      body: { name: 'shared', ownerWorkspaceId: 'w1' },
    };
    const res = createRes();
    await createSharedChannel(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('createExternalDirectMessage returns 404 when collaboration not found', async () => {
    prisma.workspaceCollaboration.findFirst.mockResolvedValue(null);
    const req: any = {
      user: { id: 'u1' },
      params: { id: 'l1' },
      body: { sourceWorkspaceId: 'w1', targetUserId: 'u2' },
    };
    const res = createRes();
    await createExternalDirectMessage(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('createCollaborationRequest returns 409 when a pending request already exists', async () => {
    prisma.workspace.findFirst.mockResolvedValue({ id: 'w2', slug: 'target', name: 'Target' });
    collabAccess.isWorkspaceAdmin.mockResolvedValue(true);
    prisma.workspaceCollaborationRequest.findFirst.mockResolvedValue({ id: 'pending-1' });

    const req: any = {
      user: { id: 'u1' },
      body: { requestingWorkspaceId: 'w1', targetWorkspaceSlug: 'target' },
    };
    const res = createRes();

    await createCollaborationRequest(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('approveCollaborationRequest creates the collaboration and audit trail on success', async () => {
    prisma.workspaceCollaborationRequest.findFirst.mockResolvedValue({
      id: 'r1',
      status: 'PENDING',
      requestingWorkspaceId: 'w1',
      targetWorkspaceId: 'w2',
      policyTemplate: { allowSharedChannels: true },
    });
    collabAccess.isWorkspaceAdmin.mockResolvedValue(true);
    prisma.collaborationPolicy.create.mockResolvedValue({ id: 'policy-1' });
    prisma.workspaceCollaboration.create.mockResolvedValue({
      id: 'link-1',
      workspaceAId: 'w1',
      workspaceBId: 'w2',
      policy: {},
    });
    prisma.workspace.findUnique.mockResolvedValue({ name: 'Target Workspace' });

    const req: any = { user: { id: 'u1' }, params: { id: 'r1' } };
    const res = createRes();

    await approveCollaborationRequest(req, res);

    expect(prisma.workspaceCollaborationRequest.update).toHaveBeenCalled();
    expect(prisma.collaborationAuditLog.create).toHaveBeenCalled();
    expect(streams.publishCollaborationInvalidate).toHaveBeenCalled();
    expect(NotificationService.notifyCollaborationAdmins).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('createSharedChannel creates a shared channel and enqueues membership sync', async () => {
    prisma.workspaceCollaboration.findFirst.mockResolvedValue({
      id: 'l1',
      status: 'ACTIVE',
      workspaceAId: 'w1',
      workspaceBId: 'w2',
      policy: { allowSharedChannels: true },
    });
    collabAccess.isWorkspaceAdmin.mockResolvedValue(true);
    prisma.channel.create.mockResolvedValue({ id: 'ch-1', workspaceId: 'w1' });

    const req: any = {
      user: { id: 'u1' },
      params: { id: 'l1' },
      body: { name: 'shared', ownerWorkspaceId: 'w1' },
    };
    const res = createRes();

    await createSharedChannel(req, res);

    expect(prisma.channel.create).toHaveBeenCalled();
    expect(enqueueMembershipOutboxEvent).toHaveBeenCalled();
    expect(streams.publishChannelEvent).toHaveBeenCalledWith('channel.created', { id: 'ch-1', workspaceId: 'w1' });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('revokeCollaborationLink revokes the link and runs cleanup', async () => {
    prisma.workspaceCollaboration.findFirst.mockResolvedValue({
      id: 'l1',
      workspaceAId: 'w1',
      workspaceBId: 'w2',
    });
    collabAccess.isWorkspaceAdmin.mockResolvedValue(true);
    prisma.workspaceCollaboration.findUniqueOrThrow.mockResolvedValue({ id: 'l1', status: 'REVOKED' });
    prisma.workspace.findUnique.mockResolvedValue({ name: 'Workspace A' });

    const req: any = { user: { id: 'u1' }, params: { id: 'l1' } };
    const res = createRes();

    await revokeCollaborationLink(req, res);

    expect(cleanupPairwiseCollaborationArtifacts).toHaveBeenCalled();
    expect(prisma.collaborationAuditLog.create).toHaveBeenCalled();
    expect(streams.publishCollaborationInvalidate).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
