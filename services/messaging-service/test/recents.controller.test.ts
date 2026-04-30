import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  member: { findFirst: vi.fn() },
  userRecent: { findMany: vi.fn(), upsert: vi.fn() },
  channel: { findFirst: vi.fn() },
  conversation: { findFirst: vi.fn() },
}));

vi.mock('../src/config/database.js', () => ({ default: prisma }));

import { getRecents, touchRecent } from '../src/controllers/recents.controller.js';

function createRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('recents.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getRecents returns 400 when workspaceId is missing', async () => {
    const req: any = { user: { id: 'u1' }, query: {} };
    const res = createRes();

    await getRecents(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'workspaceId is required' });
  });

  it('getRecents returns 200 with mapped data', async () => {
    prisma.member.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.userRecent.findMany.mockResolvedValue([
      { type: 'CHANNEL', targetId: 'c1', lastOpenedAt: new Date('2024-01-01T00:00:00.000Z') },
    ]);
    const req: any = { user: { id: 'u1' }, query: { workspaceId: 'w1' } };
    const res = createRes();

    await getRecents(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Recents fetched successfully',
      data: [{ type: 'CHANNEL', targetId: 'c1', lastOpenedAt: '2024-01-01T00:00:00.000Z' }],
    });
  });

  it('touchRecent returns 404 when channel not found for CHANNEL type', async () => {
    prisma.member.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.channel.findFirst.mockResolvedValue(null);
    const req: any = {
      user: { id: 'u1' },
      body: { type: 'CHANNEL', targetId: 'c1', workspaceId: 'w1' },
    };
    const res = createRes();

    await touchRecent(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Channel not found or you are not a member' });
  });

  it('touchRecent upserts and returns 200 for conversation type', async () => {
    prisma.member.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.conversation.findFirst.mockResolvedValue({ id: 'cv1', participants: [{ userId: 'u1' }] });
    const req: any = {
      user: { id: 'u1' },
      body: { type: 'CONVERSATION', targetId: 'cv1', workspaceId: 'w1' },
    };
    const res = createRes();

    await touchRecent(req, res);

    expect(prisma.userRecent.upsert).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'Recent touched successfully' });
  });
});
