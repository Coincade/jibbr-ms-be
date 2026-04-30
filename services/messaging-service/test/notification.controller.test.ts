import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  channelMember: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  userRecent: { upsert: vi.fn() },
  conversationParticipant: { findUnique: vi.fn() },
  conversationReadStatus: { upsert: vi.fn(), findMany: vi.fn() },
  userNotification: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  userNotificationPreference: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
  member: { findFirst: vi.fn() },
  userChannelMute: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  userPushToken: { upsert: vi.fn(), deleteMany: vi.fn() },
}));

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('@jibbr/database', () => ({ filterUnreadChannelRowsForUser: vi.fn((_p, _u, rows) => Promise.resolve(rows)) }));
vi.mock('../src/helper.js', () => ({ formatError: vi.fn(() => ({ field: 'invalid' })) }));

import {
  getNotificationPreferences,
  getUserNotifications,
  markAsRead,
  markNotificationAsRead,
  registerPushToken,
  setChannelMute,
  unregisterPushToken,
  updateNotificationPreferences,
} from '../src/controllers/notification.controller.js';

function createRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('notification.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('markAsRead returns 422 when user missing', async () => {
    const req: any = { user: undefined, body: {} };
    const res = createRes();
    await markAsRead(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('getUserNotifications returns paginated notifications', async () => {
    prisma.userNotification.findMany.mockResolvedValue([{ id: 'n1' }]);
    prisma.userNotification.count.mockResolvedValue(1);
    const req: any = { user: { id: 'u1' }, query: { page: '1', limit: '20' } };
    const res = createRes();
    await getUserNotifications(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Notifications fetched successfully',
      })
    );
  });

  it('markNotificationAsRead returns 404 when notification missing', async () => {
    prisma.userNotification.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, params: { notificationId: 'n1' } };
    const res = createRes();
    await markNotificationAsRead(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('getNotificationPreferences creates defaults when missing', async () => {
    prisma.userNotificationPreference.findUnique.mockResolvedValue(null);
    prisma.userNotificationPreference.create.mockResolvedValue({ userId: 'u1', updatedAt: new Date() });
    const req: any = { user: { id: 'u1' } };
    const res = createRes();
    await getNotificationPreferences(req, res);
    expect(prisma.userNotificationPreference.create).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('updateNotificationPreferences upserts successfully', async () => {
    prisma.userNotificationPreference.upsert.mockResolvedValue({ userId: 'u1', updatedAt: new Date(), level: 'mentions' });
    const req: any = { user: { id: 'u1' }, body: { level: 'mentions', muteAll: true } };
    const res = createRes();
    await updateNotificationPreferences(req, res);
    expect(prisma.userNotificationPreference.upsert).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('setChannelMute returns 403 when user is not channel member', async () => {
    prisma.channelMember.findUnique.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, body: { channelId: 'c1', muted: true } };
    const res = createRes();
    await setChannelMute(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('registerPushToken and unregisterPushToken succeed', async () => {
    const regReq: any = { user: { id: 'u1' }, body: { pushToken: 'expo-token', platform: 'ios' } };
    const unregReq: any = { user: { id: 'u1' }, body: { pushToken: 'expo-token' } };
    const res = createRes();
    await registerPushToken(regReq, res);
    await unregisterPushToken(unregReq, res);
    expect(prisma.userPushToken.upsert).toHaveBeenCalled();
    expect(prisma.userPushToken.deleteMany).toHaveBeenCalled();
  });
});
