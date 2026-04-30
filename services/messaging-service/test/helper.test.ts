import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const prisma = vi.hoisted(() => ({
  workspace: { findUnique: vi.fn() },
  channel: { findUnique: vi.fn() },
  conversation: { findUnique: vi.fn() },
  collaborationGroupMembership: { findMany: vi.fn() },
  member: { findMany: vi.fn(), findFirst: vi.fn() },
}));

vi.mock('../src/config/database.js', () => ({ default: prisma }));

import {
  canUserSendAttachmentsToConversation,
  canUserForwardInTownhall,
  canUserSendAttachmentsToChannel,
  checkDateHourDiff,
  formatError,
  isFileAttachmentsEnabled,
  isFileAttachmentsEnabledForChannel,
  isFileAttachmentsEnabledForConversation,
  isTownhallChannelName,
} from '../src/helper.js';

describe('helper.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formatError maps zod issues by path', () => {
    const err = new ZodError([{ code: 'custom', message: 'Invalid', path: ['email'] }]);
    expect(formatError(err)).toEqual({ email: 'Invalid' });
  });

  it('checkDateHourDiff returns positive hours', () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const hours = checkDateHourDiff(past);
    expect(hours).toBeGreaterThan(1.9);
  });

  it('isTownhallChannelName is case-insensitive', () => {
    expect(isTownhallChannelName('TownHall')).toBe(true);
    expect(isTownhallChannelName('general')).toBe(false);
  });

  it('canUserSendAttachmentsToChannel returns false when channel group policy disallows sharing', async () => {
    prisma.channel.findUnique.mockResolvedValue({
      groupId: 'g1',
      workspaceId: 'w1',
      group: { status: 'ACTIVE', policy: { allowFileSharing: false } },
      collaborationId: null,
      workspace: { fileAttachmentsEnabled: true },
    });
    await expect(canUserSendAttachmentsToChannel('c1', 'u1')).resolves.toBe(false);
  });

  it('canUserForwardInTownhall returns true for admin/moderator', async () => {
    prisma.member.findFirst.mockResolvedValue({ role: 'ADMIN' });
    await expect(canUserForwardInTownhall('w1', 'u1')).resolves.toBe(true);
  });

  it('isFileAttachmentsEnabled returns true by default when workspace missing', async () => {
    prisma.workspace.findUnique.mockResolvedValue(null);
    await expect(isFileAttachmentsEnabled('w1')).resolves.toBe(true);
  });

  it('isFileAttachmentsEnabledForChannel checks collaboration policy + host workspace toggle', async () => {
    prisma.channel.findUnique.mockResolvedValue({
      collaborationId: 'col1',
      groupId: null,
      workspace: { fileAttachmentsEnabled: true },
      collaboration: { status: 'ACTIVE', policy: { allowFileSharing: true } },
    });
    await expect(isFileAttachmentsEnabledForChannel('c1')).resolves.toBe(true);
  });

  it('canUserSendAttachmentsToChannel allows moderator override when host workspace disabled', async () => {
    prisma.channel.findUnique.mockResolvedValue({
      workspaceId: 'w1',
      groupId: null,
      collaborationId: 'col1',
      workspace: { fileAttachmentsEnabled: false },
      collaboration: { status: 'ACTIVE', policy: { allowFileSharing: true } },
      group: null,
    });
    prisma.member.findFirst.mockResolvedValue({ role: 'MODERATOR' });
    await expect(canUserSendAttachmentsToChannel('c1', 'u1')).resolves.toBe(true);
  });

  it('isFileAttachmentsEnabledForConversation enforces pairwise collaboration toggles', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      collaborationId: 'col1',
      groupId: null,
      workspace: { fileAttachmentsEnabled: true },
      collaboration: {
        status: 'ACTIVE',
        policy: { allowFileSharing: true },
        workspaceA: { fileAttachmentsEnabled: true },
        workspaceB: { fileAttachmentsEnabled: true },
      },
    });
    await expect(isFileAttachmentsEnabledForConversation('cv1')).resolves.toBe(true);
  });

  it('canUserSendAttachmentsToConversation returns false when collaboration policy disallows sharing', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      collaborationId: 'col1',
      groupId: null,
      workspace: { fileAttachmentsEnabled: true },
      collaboration: {
        status: 'ACTIVE',
        policy: { allowFileSharing: false },
        workspaceA: { fileAttachmentsEnabled: true },
        workspaceB: { fileAttachmentsEnabled: true },
      },
    });
    await expect(canUserSendAttachmentsToConversation('cv1', 'u1')).resolves.toBe(false);
  });
});
