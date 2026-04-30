import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  userNotification: { create: vi.fn() },
  channelMember: { update: vi.fn(), findMany: vi.fn() },
  conversationReadStatus: { upsert: vi.fn(), findMany: vi.fn() },
  conversationParticipant: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  userChannelMute: { findMany: vi.fn() },
  member: { findMany: vi.fn() },
  workspace: { findUnique: vi.fn() },
}));

const sendToTokens = vi.hoisted(() => vi.fn());
const shouldNotify = vi.hoisted(() => vi.fn(() => true));
const filterUserIdsWhoCanReadChannel = vi.hoisted(() => vi.fn(async (_p, _c, ids: string[]) => new Set(ids)));

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('../src/services/push.service.js', () => ({ default: { sendToTokens } }));
vi.mock('@jibbr/shared-utils', () => ({ shouldNotify }));
vi.mock('@jibbr/database', () => ({ filterUserIdsWhoCanReadChannel }));

import { NotificationService } from '../src/services/notification.service.js';

describe('notification.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createNotification maps prisma row shape', async () => {
    const now = new Date();
    prisma.userNotification.create.mockResolvedValue({
      id: 'n1',
      type: 'MENTION',
      title: 't',
      message: 'm',
      data: { a: 1 },
      userId: 'u1',
      createdAt: now,
    });
    const result = await NotificationService.createNotification({
      userId: 'u1',
      type: 'MENTION',
      title: 't',
      message: 'm',
      data: { a: 1 },
    });
    expect(result).toEqual({
      id: 'n1',
      type: 'MENTION',
      title: 't',
      message: 'm',
      data: { a: 1 },
      userId: 'u1',
      createdAt: now,
    });
  });

  it('notifyCollaborationAdmins notifies admins except actor', async () => {
    prisma.member.findMany.mockResolvedValue([{ userId: 'u2' }, { userId: 'u1' }]);
    prisma.workspace.findUnique.mockResolvedValue({ userId: 'u3' });
    prisma.userNotification.create.mockResolvedValue({
      id: 'n1', type: 'COLLABORATION_REQUEST', title: 't', message: 'm', data: {}, userId: 'u2', createdAt: new Date(),
    });

    await NotificationService.notifyCollaborationAdmins('w1', 'u1', 'COLLABORATION_REQUEST', 't', 'm', {});

    expect(prisma.userNotification.create).toHaveBeenCalledTimes(2); // u2 + u3
  });

  it('markConversationAsRead upserts unreadCount=0', async () => {
    await NotificationService.markConversationAsRead('cv1', 'u1');
    expect(prisma.conversationReadStatus.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ unreadCount: 0 }),
        create: expect.objectContaining({ unreadCount: 0 }),
      })
    );
  });

  it('notifyNewChannelMessage increments unread for allowed users and respects mute/notify rules', async () => {
    prisma.channelMember.findMany.mockResolvedValue([
      {
        userId: 'u2',
        user: {
          timezone: 'UTC',
          pushTokens: [{ token: 'ExponentPushToken[u2]' }],
          notificationPreferences: { pushNotifications: true },
        },
      },
      {
        userId: 'u3',
        user: {
          timezone: 'UTC',
          pushTokens: [{ token: 'ExponentPushToken[u3]' }],
          notificationPreferences: { pushNotifications: true },
        },
      },
    ]);
    prisma.user.findUnique.mockResolvedValue({ name: 'Sender' });
    prisma.userChannelMute.findMany.mockResolvedValue([{ userId: 'u3' }]); // u3 muted
    filterUserIdsWhoCanReadChannel.mockResolvedValue(new Set(['u2', 'u3']));
    shouldNotify.mockReturnValue(true);
    prisma.userNotification.create.mockResolvedValue({
      id: 'n1',
      type: 'NEW_MESSAGE',
      title: 't',
      message: 'm',
      data: {},
      userId: 'u2',
      createdAt: new Date(),
    });

    await NotificationService.notifyNewChannelMessage('c1', 'm1', 'u1', '<b>hello</b>', 'general');

    expect(prisma.channelMember.update).toHaveBeenCalledTimes(2); // increment unread for both allowed users
    expect(prisma.userNotification.create).toHaveBeenCalledTimes(1); // muted user skipped for notification
    expect(sendToTokens).toHaveBeenCalledTimes(1);
    expect(sendToTokens).toHaveBeenCalledWith(
      ['ExponentPushToken[u2]'],
      expect.objectContaining({
        title: 'New message in #general',
      })
    );
  });

  it('notifyMention skips push when mention preference is disabled', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ name: 'Sender' }) // sender
      .mockResolvedValueOnce({
        timezone: 'UTC',
        pushTokens: [{ token: 'ExponentPushToken[u2]' }],
        notificationPreferences: {
          pushNotifications: true,
          mentionNotifications: false,
        },
      }); // target user
    shouldNotify.mockReturnValue(true);
    prisma.userNotification.create.mockResolvedValue({
      id: 'n1',
      type: 'MENTION',
      title: 't',
      message: 'm',
      data: {},
      userId: 'u2',
      createdAt: new Date(),
    });

    await NotificationService.notifyMention('c1', 'm1', 'u2', 'u1', 'hello', 'general');

    expect(prisma.userNotification.create).toHaveBeenCalledTimes(1);
    expect(sendToTokens).not.toHaveBeenCalled();
  });

  it('notifyReaction returns early when reactor is message owner', async () => {
    await NotificationService.notifyReaction('m1', 'u1', 'u1', '🔥');
    expect(prisma.userNotification.create).not.toHaveBeenCalled();
    expect(sendToTokens).not.toHaveBeenCalled();
  });

  it('getUserUnreadCounts aggregates channel and conversation totals', async () => {
    prisma.channelMember.findMany.mockResolvedValue([
      {
        channelId: 'c1',
        unreadCount: 2,
        lastReadAt: null,
        channel: { name: 'general', workspaceId: 'w1' },
      },
    ]);
    prisma.conversationReadStatus.findMany.mockResolvedValue([
      {
        conversationId: 'cv1',
        unreadCount: 3,
        lastReadAt: null,
        conversation: { participants: [{ user: { id: 'u2', name: 'Alice', image: null } }] },
      },
    ]);

    const result = await NotificationService.getUserUnreadCounts('u1', 'w1');

    expect(result.totalUnread).toBe(5);
    expect(result.channels).toHaveLength(1);
    expect(result.conversations).toHaveLength(1);
  });

  it('markChannelAsRead throws when update fails', async () => {
    prisma.channelMember.update.mockRejectedValue(new Error('db fail'));
    await expect(NotificationService.markChannelAsRead('c1', 'u1')).rejects.toThrow('db fail');
  });
});
