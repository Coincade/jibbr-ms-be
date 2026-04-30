import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  userPushToken: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

const chunkPushNotifications = vi.hoisted(() => vi.fn());
const sendPushNotificationsAsync = vi.hoisted(() => vi.fn());
const isExpoPushToken = vi.hoisted(() => vi.fn());

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('expo-server-sdk', () => ({
  Expo: class ExpoMock {
    static isExpoPushToken = isExpoPushToken;

    chunkPushNotifications = chunkPushNotifications;

    sendPushNotificationsAsync = sendPushNotificationsAsync;
  },
}));

import PushService from '../src/services/push.service.js';

describe('push.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isExpoPushToken.mockImplementation((token: string) => token.startsWith('ExponentPushToken'));
    chunkPushNotifications.mockImplementation((messages: unknown[]) => [messages]);
    sendPushNotificationsAsync.mockResolvedValue([{ status: 'ok' }]);
    prisma.userPushToken.findMany.mockResolvedValue([]);
  });

  it('sendToTokens filters invalid tokens and sends valid payloads', async () => {
    await PushService.sendToTokens(
      ['bad-token', 'ExponentPushToken[abc]'],
      { title: 'Hello', body: 'World', data: { a: 1 } }
    );

    expect(chunkPushNotifications).toHaveBeenCalledTimes(1);
    const sentMessages = chunkPushNotifications.mock.calls[0][0];
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toEqual(
      expect.objectContaining({
        to: 'ExponentPushToken[abc]',
        title: 'Hello',
        body: 'World',
        data: { a: 1 },
        priority: 'high',
      })
    );
    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(1);
  });

  it('sendToTokens returns early when all tokens are invalid', async () => {
    isExpoPushToken.mockReturnValue(false);

    await PushService.sendToTokens(['x1', 'x2'], { title: 'T', body: 'B' });

    expect(chunkPushNotifications).not.toHaveBeenCalled();
    expect(sendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it('sendToTokens removes revoked tokens from error tickets', async () => {
    sendPushNotificationsAsync.mockResolvedValue([
      { status: 'error', details: { error: 'DeviceNotRegistered' }, message: 'gone' },
      { status: 'error', details: { error: 'InvalidCredentials' }, message: 'invalid' },
    ]);

    await PushService.sendToTokens(
      ['ExponentPushToken[t1]', 'ExponentPushToken[t2]'],
      { title: 'A', body: 'B' }
    );

    expect(prisma.userPushToken.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.userPushToken.deleteMany).toHaveBeenNthCalledWith(1, { where: { token: 'ExponentPushToken[t1]' } });
    expect(prisma.userPushToken.deleteMany).toHaveBeenNthCalledWith(2, { where: { token: 'ExponentPushToken[t2]' } });
  });

  it('sendToUser loads tokens and delegates to sendToTokens', async () => {
    const sendToTokensSpy = vi.spyOn(PushService, 'sendToTokens').mockResolvedValue(undefined);
    prisma.userPushToken.findMany.mockResolvedValue([{ token: 'ExponentPushToken[a]' }, { token: 'ExponentPushToken[b]' }]);

    await PushService.sendToUser('u1', { title: 'T', body: 'B' });

    expect(prisma.userPushToken.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      select: { token: true },
    });
    expect(sendToTokensSpy).toHaveBeenCalledWith(
      ['ExponentPushToken[a]', 'ExponentPushToken[b]'],
      { title: 'T', body: 'B' }
    );
  });
});
