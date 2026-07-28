import { describe, expect, it, vi } from 'vitest';

import {
  canUserMutateSharedChannel,
  canUserReadChannelHistory,
  isCollaborationDmMutationAllowedForConversation,
} from '../src/collaborationGuards.js';

describe('collaborationGuards', () => {
  it('allows host workspace members to keep reading shared-channel history after link revocation', async () => {
    const prisma: any = {
      channelMember: { findFirst: vi.fn().mockResolvedValue({ id: 'cm-1' }) },
      channel: {
        findUnique: vi.fn().mockResolvedValue({
          workspaceId: 'host-ws',
          collaborationId: 'link-1',
          groupId: null,
        }),
      },
      workspaceCollaboration: { findFirst: vi.fn().mockResolvedValue(null) },
      collaborationGroup: { findFirst: vi.fn().mockResolvedValue(null) },
      member: { findFirst: vi.fn().mockResolvedValue({ id: 'm-1' }) },
    };

    await expect(canUserReadChannelHistory(prisma, 'ch-1', 'user-1')).resolves.toBe(true);
  });

  it('denies shared-channel mutation when the group is inactive', async () => {
    const prisma: any = {
      channelMember: { findFirst: vi.fn().mockResolvedValue({ id: 'cm-1' }) },
      channel: {
        findFirst: vi.fn().mockResolvedValue({
          workspaceId: 'host-ws',
          collaborationId: null,
          groupId: 'group-1',
        }),
      },
      member: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      workspaceCollaboration: { findFirst: vi.fn() },
      collaborationGroup: { findFirst: vi.fn().mockResolvedValue(null) },
      collaborationGroupMembership: { findFirst: vi.fn() },
    };

    await expect(canUserMutateSharedChannel(prisma, 'user-1', 'ch-1')).resolves.toBe(false);
  });

  it('denies cross-workspace DM mutation when the collaboration policy is inactive', async () => {
    const prisma: any = {
      conversation: {
        findUnique: vi.fn().mockResolvedValue({ collaborationId: 'link-1', groupId: null }),
      },
      workspaceCollaboration: { findFirst: vi.fn().mockResolvedValue(null) },
      collaborationGroup: { findFirst: vi.fn() },
    };

    await expect(isCollaborationDmMutationAllowedForConversation(prisma, 'cv-1')).resolves.toBe(false);
  });
});
