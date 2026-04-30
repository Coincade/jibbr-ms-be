import { beforeEach, describe, expect, it, vi } from 'vitest';

const getOnlineUsers = vi.hoisted(() => vi.fn(() => ['u1', 'u2']));
const isUserOnline = vi.hoisted(() => vi.fn(() => true));
const getUsersOnlineStatus = vi.hoisted(() => vi.fn(() => ({ u1: true, u2: false })));
const getOnlineUsersCount = vi.hoisted(() => vi.fn(() => 2));

vi.mock('../src/websocket/index.js', () => ({
  getOnlineUsers,
  isUserOnline,
  getUsersOnlineStatus,
  getOnlineUsersCount,
}));

import {
  checkMultipleUsersStatus,
  checkUserOnlineStatus,
  getOnlineStats,
  getOnlineUsersList,
} from '../src/controllers/presence.controller.js';

function createRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('presence.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 422 when user is missing', async () => {
    const res = createRes();
    await getOnlineUsersList({} as any, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('returns online users list and count', async () => {
    const res = createRes();
    await getOnlineUsersList({ user: { id: 'u0' } } as any, res);
    expect(getOnlineUsers).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { onlineUsers: ['u1', 'u2'], count: 2 },
      })
    );
  });

  it('checks single user online status', async () => {
    const res = createRes();
    await checkUserOnlineStatus({ user: { id: 'u0' }, params: { userId: 'u9' } } as any, res);
    expect(isUserOnline).toHaveBeenCalledWith('u9');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 422 for single-user status when auth user is missing', async () => {
    const res = createRes();
    await checkUserOnlineStatus({ params: { userId: 'u9' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('returns 400 when userIds is not array', async () => {
    const res = createRes();
    await checkMultipleUsersStatus({ user: { id: 'u0' }, body: { userIds: 'bad' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 422 for multi-user status when auth user is missing', async () => {
    const res = createRes();
    await checkMultipleUsersStatus({ body: { userIds: ['u1'] } } as any, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('returns multiple users statuses', async () => {
    const res = createRes();
    await checkMultipleUsersStatus({ user: { id: 'u0' }, body: { userIds: ['u1', 'u2'] } } as any, res);
    expect(getUsersOnlineStatus).toHaveBeenCalledWith(['u1', 'u2']);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns online stats count', async () => {
    const res = createRes();
    await getOnlineStats({ user: { id: 'u0' } } as any, res);
    expect(getOnlineUsersCount).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { onlineUsersCount: 2 } })
    );
  });

  it('returns 422 for stats when auth user is missing', async () => {
    const res = createRes();
    await getOnlineStats({} as any, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('returns 500 when list fetch throws unexpectedly', async () => {
    const res = createRes();
    getOnlineUsers.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await getOnlineUsersList({ user: { id: 'u0' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns 500 when single-status check throws unexpectedly', async () => {
    const res = createRes();
    isUserOnline.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await checkUserOnlineStatus({ user: { id: 'u0' }, params: { userId: 'u9' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns 500 when multi-status check throws unexpectedly', async () => {
    const res = createRes();
    getUsersOnlineStatus.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await checkMultipleUsersStatus({ user: { id: 'u0' }, body: { userIds: ['u1'] } } as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns 500 when stats fetch throws unexpectedly', async () => {
    const res = createRes();
    getOnlineUsersCount.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await getOnlineStats({ user: { id: 'u0' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
