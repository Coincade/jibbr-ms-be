import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  member: { findFirst: vi.fn() },
  starboardItem: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../src/config/database.js', () => ({ default: prisma }));

import { getStarboard, replaceStarboard } from '../src/controllers/starboard.controller.js';

function createRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('starboard.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockResolvedValue([]);
  });

  it('getStarboard returns 400 when workspaceId is missing', async () => {
    const req: any = { user: { id: 'u1' }, query: {} };
    const res = createRes();

    await getStarboard(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('getStarboard returns 403 when user is not a workspace member', async () => {
    prisma.member.findFirst.mockResolvedValue(null);
    const req: any = { user: { id: 'u1' }, query: { workspaceId: 'w1' } };
    const res = createRes();

    await getStarboard(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.starboardItem.findMany).not.toHaveBeenCalled();
  });

  it('getStarboard returns ordered items mapped to client types', async () => {
    prisma.member.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.starboardItem.findMany.mockResolvedValue([
      { itemType: 'MEMBER', itemId: 'u2' },
      { itemType: 'CHANNEL', itemId: 'c1' },
    ]);
    const req: any = { user: { id: 'u1' }, query: { workspaceId: 'w1' } };
    const res = createRes();

    await getStarboard(req, res);

    expect(prisma.starboardItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', workspaceId: 'w1' } })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Starboard fetched successfully',
      data: {
        items: [
          { type: 'member', id: 'u2' },
          { type: 'channel', id: 'c1' },
        ],
      },
    });
  });

  it('replaceStarboard returns 400 for invalid body', async () => {
    const req: any = { user: { id: 'u1' }, body: { workspaceId: 'w1', items: [{ type: 'bogus', id: 'x' }] } };
    const res = createRes();

    await replaceStarboard(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('replaceStarboard rejects more than 200 items', async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ type: 'channel', id: `c${i}` }));
    const req: any = { user: { id: 'u1' }, body: { workspaceId: 'w1', items } };
    const res = createRes();

    await replaceStarboard(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('replaceStarboard replaces list with deduped positions in a transaction', async () => {
    prisma.member.findFirst.mockResolvedValue({ id: 'm1' });
    const req: any = {
      user: { id: 'u1' },
      body: {
        workspaceId: 'w1',
        items: [
          { type: 'channel', id: 'c1' },
          { type: 'member', id: 'u2' },
          { type: 'channel', id: 'c1' },
        ],
      },
    };
    const res = createRes();

    await replaceStarboard(req, res);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.starboardItem.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', workspaceId: 'w1' } });
    expect(prisma.starboardItem.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 'u1', workspaceId: 'w1', itemType: 'CHANNEL', itemId: 'c1', position: 0 },
        { userId: 'u1', workspaceId: 'w1', itemType: 'MEMBER', itemId: 'u2', position: 1 },
      ],
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
