import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  channelMember: { findMany: vi.fn() },
  channel: { findUnique: vi.fn() },
  messageMention: { createMany: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  user: { findMany: vi.fn() },
  userChannelMute: { findMany: vi.fn() },
}));

const parseMentions = vi.hoisted(() => vi.fn());
const sanitizeMessageHtml = vi.hoisted(() => vi.fn((s: string) => s));
const checkSpecialMentionRateLimit = vi.hoisted(() => vi.fn());
const createNotification = vi.hoisted(() => vi.fn());
const shouldNotify = vi.hoisted(() => vi.fn(() => true));
const canUserReadChannelHistory = vi.hoisted(() => vi.fn(async () => true));

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('../src/libs/tiptapMentionParser.js', () => ({ parseMentions }));
vi.mock('../src/libs/sanitizeHtml.js', () => ({ sanitizeMessageHtml }));
vi.mock('../src/libs/rateLimiter.js', () => ({ checkSpecialMentionRateLimit }));
vi.mock('../src/services/notification.service.js', () => ({
  NotificationService: { createNotification },
}));
vi.mock('@jibbr/shared-utils', () => ({ shouldNotify }));
vi.mock('@jibbr/database', () => ({ canUserReadChannelHistory }));

import {
  createMentionsAndNotifications,
  processMentions,
  updateMentionsForMessage,
} from '../src/services/mention.service.js';

describe('mention.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseMentions.mockReturnValue([]);
    checkSpecialMentionRateLimit.mockResolvedValue({ allowed: true });
    prisma.channelMember.findMany.mockResolvedValue([]);
    prisma.channel.findUnique.mockResolvedValue({ name: 'general' });
    prisma.user.findMany.mockResolvedValue([]);
    prisma.userChannelMute.findMany.mockResolvedValue([]);
    prisma.messageMention.findMany.mockResolvedValue([]);
    shouldNotify.mockReturnValue(true);
  });

  it('processMentions removes duplicates and author id', async () => {
    parseMentions.mockReturnValue([{ userId: 'u2' }, { userId: 'u2' }, { userId: 'u1' }]);
    const result = await processMentions('hello', 'u1', null);
    expect(result.mentionedUserIds).toEqual(['u2']);
  });

  it('processMentions expands @channel when allowed and not rate-limited', async () => {
    parseMentions.mockReturnValue([]);
    prisma.channelMember.findMany.mockResolvedValue([{ userId: 'u2' }, { userId: 'u3' }]);
    const result = await processMentions('@channel hi', 'u1', 'c1');
    expect(checkSpecialMentionRateLimit).toHaveBeenCalled();
    expect(result.mentionedUserIds.sort()).toEqual(['u2', 'u3']);
  });

  it('createMentionsAndNotifications creates mentions and sends notifications', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u2', timezone: null, notificationPreferences: null },
    ]);
    await createMentionsAndNotifications('m1', 'c1', ['u2'], 'u1', null);
    expect(prisma.messageMention.createMany).toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalled();
  });

  it('updateMentionsForMessage deletes removed and adds new mentions', async () => {
    prisma.messageMention.findMany.mockResolvedValue([{ userId: 'u2' }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u3', timezone: null, notificationPreferences: null }]);
    await updateMentionsForMessage('m1', 'c1', ['u3'], 'u1', null);
    expect(prisma.messageMention.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: { in: ['u2'] } }) })
    );
    expect(prisma.messageMention.createMany).toHaveBeenCalled();
  });
});
