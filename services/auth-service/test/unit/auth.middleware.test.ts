import { describe, expect, it, vi } from 'vitest';
import authMiddleware from '../../src/middleware/Auth.middleware.js';
vi.mock('jsonwebtoken', () => {
  const verify = vi.fn();
  return {
    default: { verify },
    verify,
  };
});
type MockRes = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};
function createRes(): MockRes {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
describe('Auth Middleware Testing', () => {
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
      jwtMod.default.verify.mockImplementation((_token: string, _secret: string, cb: any) =>
        cb(new Error('bad token'))
      );
      const req: any = { headers: { authorization: 'Bearer bad' } };
      const res = createRes();
      const next = vi.fn();
      await authMiddleware(req, res as any, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ status: 401, message: 'Unauthorized' });
      expect(next).not.toHaveBeenCalled();
    });
    it('returns 401 when JWT verification fails', async () => {
        const jwtMod: any = await import('jsonwebtoken');
        jwtMod.default.verify.mockImplementation((_token: string, _secret: string, cb: any) =>
          cb(new Error('bad token'))
        );
        const req: any = { headers: { authorization: 'Bearer bad' } };
        const res = createRes();
        const next = vi.fn();
        await authMiddleware(req, res as any, next);
        expect(res.json).toHaveBeenCalledWith({ status: 401, message: 'Unauthorized' });
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
      });
      it('sets req.user and calls next when JWT is valid', async () => {
        const jwtMod: any = await import('jsonwebtoken');
        const user = { id: 'u1', email: 'a@b.com' };
        jwtMod.default.verify.mockImplementation((_token: string, _secret: string, cb: any) =>
          cb(null, user)
        );
        process.env.JWT_SECRET = 'test-secret';
        const req: any = { headers: { authorization: 'Bearer good' } };
        const res = createRes();
        const next = vi.fn();
        await authMiddleware(req, res as any, next);
        expect(req.user).toEqual(user);
        expect(next).toHaveBeenCalledTimes(1);
      });
    });