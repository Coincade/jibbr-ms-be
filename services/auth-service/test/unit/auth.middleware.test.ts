import { describe, expect, it, vi, beforeEach } from 'vitest';
import authMiddleware from '../../src/middleware/Auth.middleware.js';
import { createRes } from '../utils/http.js';

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../../src/config/database.js', () => ({ default: prismaMock }));

vi.mock('jsonwebtoken', () => {
  const verify = vi.fn();
  return {
    default: { verify },
    verify,
  };
});

describe('Auth Middleware Testing', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockReset();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const req: any = { headers: {} };
    const res = createRes();
    const next = vi.fn();
    await authMiddleware(req, res as any, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ status: 401, message: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when JWT verification fails', async () => {
    const jwtMod: any = await import('jsonwebtoken');
    jwtMod.default.verify.mockImplementation(() => {
      throw new Error('bad token');
    });
    const req: any = { headers: { authorization: 'Bearer bad' } };
    const res = createRes();
    const next = vi.fn();
    await authMiddleware(req, res as any, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ status: 401, message: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.user and calls next when JWT is valid', async () => {
    const jwtMod: any = await import('jsonwebtoken');
    const user = { id: 'u1', email: 'a@b.com', tv: 0 };
    jwtMod.default.verify.mockReturnValue(user);
    prismaMock.user.findUnique.mockResolvedValue({ tokenVersion: 0 });
    process.env.JWT_SECRET = 'test-secret';
    const req: any = { headers: { authorization: 'Bearer good' } };
    const res = createRes();
    const next = vi.fn();
    await authMiddleware(req, res as any, next);
    expect(req.user).toEqual(user);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 401 when tokenVersion does not match', async () => {
    const jwtMod: any = await import('jsonwebtoken');
    const user = { id: 'u1', email: 'a@b.com', tv: 0 };
    jwtMod.default.verify.mockReturnValue(user);
    prismaMock.user.findUnique.mockResolvedValue({ tokenVersion: 2 });
    process.env.JWT_SECRET = 'test-secret';
    const req: any = { headers: { authorization: 'Bearer good' } };
    const res = createRes();
    const next = vi.fn();
    await authMiddleware(req, res as any, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
