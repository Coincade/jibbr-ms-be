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
  canAccessWorkspaceResource,
  canUserReadConversationHistory,
  getActiveUserWorkspaceIds,
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
});
