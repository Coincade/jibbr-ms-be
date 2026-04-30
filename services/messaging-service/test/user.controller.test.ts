import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  user: { update: vi.fn(), findUnique: vi.fn() },
  member: { findFirst: vi.fn(), findMany: vi.fn() },
  channelMember: { findFirst: vi.fn(), findMany: vi.fn() },
  workspaceCollaboration: { findMany: vi.fn(), findFirst: vi.fn() },
  collaborationGroupMembership: { findMany: vi.fn() },
  collaborationGroup: { findFirst: vi.fn() },
}));

const publishUserStatusChangedEvent = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('../src/services/streams-publisher.service.js', () => ({ publishUserStatusChangedEvent }));

import {
  getMe,
  getMyStatus,
  searchUsers,
  updateMe,
  updateMyStatus,
  updateMyTimezone,
} from '../src/controllers/user.controller.js';

function createRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('user.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('searchUsers returns 403 when requester is not a channel member', async () => {
    prisma.channelMember.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, query: { channelId: 'c1', q: 'a' } };
    const res = createRes();
    await searchUsers(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('updateMyStatus updates user status and returns 200', async () => {
    prisma.user.update.mockResolvedValue({});
    const req: any = { user: { id: 'u1' }, body: { status: 'available' } };
    const res = createRes();
    await updateMyStatus(req, res);
    expect(prisma.user.update).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('getMyStatus returns 404 when user record missing', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' } };
    const res = createRes();
    await getMyStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('getMe returns profile payload when user exists', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      name: 'Alice',
      email: 'alice@example.com',
      image: null,
      timezone: null,
      phone: null,
      employeeId: null,
      birthday: null,
      designation: null,
    });
    const req: any = { user: { id: 'u1' } };
    const res = createRes();
    await getMe(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Profile fetched successfully' }));
  });

  it('updateMe updates only provided fields', async () => {
    prisma.user.update.mockResolvedValue({
      id: 'u1',
      name: 'New Name',
      email: 'alice@example.com',
      image: null,
      timezone: null,
      phone: null,
      employeeId: null,
      birthday: null,
      designation: null,
    });
    const req: any = { user: { id: 'u1' }, body: { name: 'New Name' } };
    const res = createRes();
    await updateMe(req, res);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'New Name' }),
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('updateMyTimezone persists timezone', async () => {
    prisma.user.update.mockResolvedValue({});
    const req: any = { user: { id: 'u1' }, body: { timezone: 'Asia/Kolkata' } };
    const res = createRes();
    await updateMyTimezone(req, res);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { timezone: 'Asia/Kolkata' } })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
