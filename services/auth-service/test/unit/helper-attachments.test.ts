import ejs from 'ejs';
import { ZodError } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { findUniqueWorkspace, findUniqueChannel, findUniqueConversation } = vi.hoisted(() => ({
  findUniqueWorkspace: vi.fn(),
  findUniqueChannel: vi.fn(),
  findUniqueConversation: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  default: {
    workspace: { findUnique: findUniqueWorkspace },
    channel: { findUnique: findUniqueChannel },
    conversation: { findUnique: findUniqueConversation },
  },
}));

import {
  checkDateHourDiff,
  formatError,
  isFileAttachmentsEnabled,
  isFileAttachmentsEnabledForChannel,
  isFileAttachmentsEnabledForConversation,
  renderEmailEjs,
} from '../../src/helper.js';

describe('helper formatError, renderEmailEjs, checkDateHourDiff', () => {
  it('formatError maps zod issues by path', () => {
    const err = new ZodError([{ code: 'custom', message: 'Invalid', path: ['email'] }]);
    expect(formatError(err)).toEqual({ email: 'Invalid' });
  });

  it('checkDateHourDiff returns hours since a past date', () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const hours = checkDateHourDiff(past);
    expect(hours).toBeGreaterThan(1.99);
    expect(hours).toBeLessThan(2.01);
  });

  it('renderEmailEjs delegates to ejs.renderFile', async () => {
    const spy = vi.spyOn(ejs, 'renderFile').mockResolvedValue('<stub/>' as never);
    const html = await renderEmailEjs('verify', { token: 'x' });
    expect(html).toBe('<stub/>');
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/views[/\\]emails[/\\]verify\.ejs$/),
      { token: 'x' },
    );
    spy.mockRestore();
  });
});

describe('helper file attachment flags', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    findUniqueWorkspace.mockReset();
    findUniqueChannel.mockReset();
    findUniqueConversation.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('isFileAttachmentsEnabled returns workspace flag', async () => {
    findUniqueWorkspace.mockResolvedValue({ fileAttachmentsEnabled: false });
    await expect(isFileAttachmentsEnabled('ws-1')).resolves.toBe(false);
  });

  it('isFileAttachmentsEnabled defaults true when workspace missing', async () => {
    findUniqueWorkspace.mockResolvedValue(null);
    await expect(isFileAttachmentsEnabled('ws-1')).resolves.toBe(true);
  });

  it('isFileAttachmentsEnabled defaults true on prisma error', async () => {
    findUniqueWorkspace.mockRejectedValue(new Error('db'));
    await expect(isFileAttachmentsEnabled('ws-1')).resolves.toBe(true);
  });

  it('isFileAttachmentsEnabledForChannel reads nested workspace', async () => {
    findUniqueChannel.mockResolvedValue({
      workspace: { fileAttachmentsEnabled: false },
    });
    await expect(isFileAttachmentsEnabledForChannel('ch-1')).resolves.toBe(false);
  });

  it('isFileAttachmentsEnabledForChannel defaults true when missing', async () => {
    findUniqueChannel.mockResolvedValue(null);
    await expect(isFileAttachmentsEnabledForChannel('ch-1')).resolves.toBe(true);
  });

  it('isFileAttachmentsEnabledForChannel defaults true on error', async () => {
    findUniqueChannel.mockRejectedValue(new Error('db'));
    await expect(isFileAttachmentsEnabledForChannel('ch-1')).resolves.toBe(true);
  });

  it('isFileAttachmentsEnabledForConversation reads nested workspace', async () => {
    findUniqueConversation.mockResolvedValue({
      workspace: { fileAttachmentsEnabled: false },
    });
    await expect(isFileAttachmentsEnabledForConversation('conv-1')).resolves.toBe(false);
  });

  it('isFileAttachmentsEnabledForConversation defaults true when missing', async () => {
    findUniqueConversation.mockResolvedValue(null);
    await expect(isFileAttachmentsEnabledForConversation('conv-1')).resolves.toBe(true);
  });

  it('isFileAttachmentsEnabledForConversation defaults true on error', async () => {
    findUniqueConversation.mockRejectedValue(new Error('db'));
    await expect(isFileAttachmentsEnabledForConversation('conv-1')).resolves.toBe(true);
  });
});
