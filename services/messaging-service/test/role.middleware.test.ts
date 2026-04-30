import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  member: { findFirst: vi.fn() },
}));

vi.mock('../src/config/database.js', () => ({ default: prisma }));

import roleMiddleware from '../src/middleware/Role.middleware.js';

function createRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('Role middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when req.user is missing', async () => {
    const req: any = { user: undefined, params: { id: 'w1' } };
    const res = createRes();
    const next = vi.fn();
    await roleMiddleware(['ADMIN'])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 403 when member role is not allowed', async () => {
    prisma.member.findFirst.mockResolvedValue({ role: 'MEMBER' });
    const req: any = { user: { id: 'u1' }, params: { id: 'w1' } };
    const res = createRes();
    const next = vi.fn();
    await roleMiddleware(['ADMIN'])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when allowed role is present', async () => {
    prisma.member.findFirst.mockResolvedValue({ role: 'ADMIN' });
    const req: any = { user: { id: 'u1' }, params: { id: 'w1' } };
    const res = createRes();
    const next = vi.fn();
    await roleMiddleware(['ADMIN'])(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
