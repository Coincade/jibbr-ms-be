import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const prisma = vi.hoisted(() => ({
  channel: { findUnique: vi.fn() },
  conversation: { findUnique: vi.fn() },
  member: { findFirst: vi.fn() },
}));

vi.mock('../src/config/database.js', () => ({ default: prisma }));

import {
  canUserForwardInTownhall,
  canUserSendAttachmentsToChannel,
  checkDateHourDiff,
  formatError,
  isTownhallChannelName,
} from '../src/helper.js';

describe('socket helper', () => {
  beforeEach(() => vi.clearAllMocks());

  it('formatError maps zod issues by path', () => {
    const err = new ZodError([{ code: 'custom', message: 'Invalid', path: ['email'] }]);
    expect(formatError(err)).toEqual({ email: 'Invalid' });
  });

  it('checkDateHourDiff returns positive hours', () => {
    const past = new Date(Date.now() - 3600 * 1000);
    expect(checkDateHourDiff(past)).toBeGreaterThan(0.9);
  });

  it('isTownhallChannelName compares case-insensitively', () => {
    expect(isTownhallChannelName('TownHall')).toBe(true);
    expect(isTownhallChannelName('general')).toBe(false);
  });

  it('canUserSendAttachmentsToChannel denies when collaboration file sharing is off', async () => {
    prisma.channel.findUnique.mockResolvedValue({
      collaborationId: 'col1',
      workspace: { fileAttachmentsEnabled: true },
      collaboration: { status: 'ACTIVE', policy: { allowFileSharing: false } },
    });
    await expect(canUserSendAttachmentsToChannel('c1', 'u1')).resolves.toBe(false);
  });

  it('canUserForwardInTownhall allows ADMIN', async () => {
    prisma.member.findFirst.mockResolvedValue({ role: 'ADMIN' });
    await expect(canUserForwardInTownhall('w1', 'u1')).resolves.toBe(true);
  });
});
