import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  workspace: { findFirst: vi.fn() },
  member: { findFirst: vi.fn(), findMany: vi.fn() },
  workspaceCollaboration: { findFirst: vi.fn(), findMany: vi.fn() },
  collaborationGroup: { findFirst: vi.fn(), findMany: vi.fn() },
  conversationParticipant: { findFirst: vi.fn() },
  conversation: { findUnique: vi.fn() },
}));

const canUserMutateSharedChannelDb = vi.hoisted(() => vi.fn());
const canUserReadChannelHistoryDb = vi.hoisted(() => vi.fn());
const isCollaborationDmMutationAllowedDb = vi.hoisted(() => vi.fn());

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('@jibbr/database', () => ({
  canUserMutateSharedChannel: canUserMutateSharedChannelDb,
  canUserReadChannelHistory: canUserReadChannelHistoryDb,
  isCollaborationDmMutationAllowedForConversation: isCollaborationDmMutationAllowedDb,
}));

import {
  canAccessViaGroup,
  canAccessWorkspaceResource,
  canUserReadConversationHistory,
  getActiveUserWorkspaceIds,
  isCollaborationFileSharingAllowed,
  isPolicyAllowedForResource,
  isWorkspaceAdmin,
} from '../src/helpers/collaborationAccess.js';

describe('helpers/collaborationAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('isWorkspaceAdmin returns true for workspace owner', async () => {
    prisma.workspace.findFirst.mockResolvedValue({ userId: 'u1' });
    prisma.member.findFirst.mockResolvedValue({ role: 'MEMBER' });
    await expect(isWorkspaceAdmin('u1', 'w1')).resolves.toBe(true);
  });

  it('getActiveUserWorkspaceIds maps membership rows', async () => {
    prisma.member.findMany.mockResolvedValue([{ workspaceId: 'w1' }, { workspaceId: 'w2' }]);
    await expect(getActiveUserWorkspaceIds('u1')).resolves.toEqual(['w1', 'w2']);
  });

  it('isPolicyAllowedForResource maps resource types correctly', () => {
    const policy = { allowExternalDiscovery: true, allowCrossWorkspaceDm: false, allowSharedChannels: true };
    expect(isPolicyAllowedForResource('workspace', policy)).toBe(true);
    expect(isPolicyAllowedForResource('conversation', policy)).toBe(false);
    expect(isPolicyAllowedForResource('channel', policy)).toBe(true);
  });

  it('canAccessWorkspaceResource returns true for direct membership', async () => {
    prisma.member.findFirst.mockResolvedValueOnce({ id: 'm1' });
    await expect(canAccessWorkspaceResource('u1', 'w1', 'workspace')).resolves.toBe(true);
  });

  it('canUserReadConversationHistory falls back to source workspace membership', async () => {
    prisma.conversationParticipant.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.conversation.findUnique.mockResolvedValue({ workspaceId: 'w1', collaborationId: 'c1', groupId: null });
    isCollaborationDmMutationAllowedDb.mockResolvedValue(false);
    prisma.member.findFirst.mockResolvedValue({ id: 'm1' });

    await expect(canUserReadConversationHistory('cv1', 'u1')).resolves.toBe(true);
  });

  it('canAccessWorkspaceResource falls back to active collaboration groups', async () => {
    prisma.member.findFirst.mockResolvedValueOnce(null);
    prisma.member.findMany.mockResolvedValue([{ workspaceId: 'w-user' }]);
    prisma.workspaceCollaboration.findMany.mockResolvedValue([]);
    prisma.collaborationGroup.findMany.mockResolvedValue([
      {
        policy: {
          allowExternalDiscovery: true,
          allowCrossWorkspaceDm: false,
          allowSharedChannels: false,
        },
      },
    ]);

    await expect(canAccessWorkspaceResource('u1', 'w-target', 'workspace')).resolves.toBe(true);
  });

  it('canUserReadConversationHistory denies access when the fallback workspace membership is gone', async () => {
    prisma.conversationParticipant.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.conversation.findUnique.mockResolvedValue({ workspaceId: 'w1', collaborationId: 'c1', groupId: null });
    isCollaborationDmMutationAllowedDb.mockResolvedValue(false);
    prisma.member.findFirst.mockResolvedValue(null);

    await expect(canUserReadConversationHistory('cv1', 'u1')).resolves.toBe(false);
  });

  it('canAccessViaGroup is true when a group policy allows the resource', async () => {
    prisma.collaborationGroup.findMany.mockResolvedValue([
      { policy: { allowExternalDiscovery: true, allowCrossWorkspaceDm: false, allowSharedChannels: true } },
    ]);
    await expect(canAccessViaGroup(['w1'], 'w2', 'channel')).resolves.toBe(true);
  });

  it('canAccessViaGroup is false when no group matches', async () => {
    prisma.collaborationGroup.findMany.mockResolvedValue([]);
    await expect(canAccessViaGroup(['w1'], 'w2', 'channel')).resolves.toBe(false);
  });

  it('isCollaborationFileSharingAllowed reads the active link policy', async () => {
    prisma.workspaceCollaboration.findFirst.mockResolvedValue({
      policy: { allowFileSharing: true },
    });
    await expect(isCollaborationFileSharingAllowed('link-1')).resolves.toBe(true);
  });

  it('isCollaborationFileSharingAllowed is false when the link is missing', async () => {
    prisma.workspaceCollaboration.findFirst.mockResolvedValue(null);
    await expect(isCollaborationFileSharingAllowed('missing')).resolves.toBe(false);
  });
});
