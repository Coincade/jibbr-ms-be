import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---- Mock route dependencies ----
const authController = vi.hoisted(() => ({
  register: vi.fn((_req: any, res: any) => res.status(200).json({ ok: 'register' })),
  login: vi.fn((_req: any, res: any) => res.status(200).json({ ok: 'login' })),
  logout: vi.fn((_req: any, res: any) => res.status(200).json({ ok: 'logout' })),
  getUser: vi.fn((_req: any, res: any) => res.status(200).json({ ok: 'getUser' })),
  forgetPassword: vi.fn((_req: any, res: any) => res.status(200).json({ ok: 'forgetPassword' })),
  forgetResetPassword: vi.fn((_req: any, res: any) => res.status(200).json({ ok: 'forgetResetPassword' })),
  resetPassword: vi.fn((_req: any, res: any) => res.status(200).json({ ok: 'resetPassword' })),
  deleteUser: vi.fn((_req: any, res: any) => res.status(200).json({ ok: 'deleteUser' })),
  resendVerificationEmail: vi.fn((_req: any, res: any) =>
    res.status(200).json({ ok: 'resendVerificationEmail' })
  ),
  verifyEmail: vi.fn((_req: any, res: any) => res.status(200).json({ ok: 'verifyEmail' })),
  verifyError: vi.fn((_req: any, res: any) => res.status(200).json({ ok: 'verifyError' })),
}));

vi.mock('../../src/controllers/auth.controller.js', () => authController);

const internalController = vi.hoisted(() => ({
  checkEmailRegistered: vi.fn((_req: any, res: any) =>
    res.status(200).json({ ok: 'checkEmailRegistered' })
  ),
  sendBridgeInviteEmail: vi.fn((_req: any, res: any) =>
    res.status(200).json({ ok: 'sendBridgeInviteEmail' })
  ),
}));

vi.mock('../../src/controllers/internal.controller.js', () => internalController);

const authMiddleware = vi.hoisted(() => vi.fn((_req: any, _res: any, next: any) => next()));
vi.mock('../../src/middleware/Auth.middleware.js', () => ({ default: authMiddleware }));

vi.mock('../../src/config/rateLimit.js', () => ({
  appLimiter: (_req: any, _res: any, next: any) => next(),
  authLimiter: (_req: any, _res: any, next: any) => next(),
}));

// Import routes after mocks
import authRoutes from '../../src/routes/auth.route.js';
import verifyRoutes from '../../src/routes/verify.route.js';
import internalRoutes from '../../src/routes/internal.route.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/verify', verifyRoutes);
  app.use('/api/internal', internalRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Routes Wiring Test', () => {
  describe('auth routes (/api/auth)', () => {
    it('POST /register calls register', async () => {
      const app = createTestApp();
      const res = await request(app).post('/api/auth/register').send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: 'register' });
      expect(authController.register).toHaveBeenCalledTimes(1);
    });

    it('POST /login calls login', async () => {
      const app = createTestApp();
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: 'login' });
      expect(authController.login).toHaveBeenCalledTimes(1);
    });

    it('POST /logout calls logout', async () => {
      const app = createTestApp();
      const res = await request(app).post('/api/auth/logout').send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: 'logout' });
      expect(authController.logout).toHaveBeenCalledTimes(1);
    });

    it('POST /resend-verification calls resendVerificationEmail', async () => {
      const app = createTestApp();
      const res = await request(app).post('/api/auth/resend-verification').send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: 'resendVerificationEmail' });
      expect(authController.resendVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it('POST /forget-password calls forgetPassword', async () => {
      const app = createTestApp();
      const res = await request(app).post('/api/auth/forget-password').send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: 'forgetPassword' });
      expect(authController.forgetPassword).toHaveBeenCalledTimes(1);
    });

    it('POST /forget-reset-password calls forgetResetPassword', async () => {
      const app = createTestApp();
      const res = await request(app).post('/api/auth/forget-reset-password').send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: 'forgetResetPassword' });
      expect(authController.forgetResetPassword).toHaveBeenCalledTimes(1);
    });

    it('POST /reset-password calls resetPassword', async () => {
      const app = createTestApp();
      const res = await request(app).post('/api/auth/reset-password').send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: 'resetPassword' });
      expect(authController.resetPassword).toHaveBeenCalledTimes(1);
    });

    it('GET /user uses authMiddleware then getUser', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/auth/user');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: 'getUser' });
      expect(authMiddleware).toHaveBeenCalledTimes(1);
      expect(authController.getUser).toHaveBeenCalledTimes(1);
    });

    it('GET /user can be blocked by authMiddleware', async () => {
      authMiddleware.mockImplementationOnce((_req: any, res: any, _next: any) =>
        res.status(401).json({ status: 401, message: 'Unauthorized' })
      );
      const app = createTestApp();
      const res = await request(app).get('/api/auth/user');
      expect(res.status).toBe(401);
      expect(authController.getUser).not.toHaveBeenCalled();
    });

    it('DELETE /user/:id uses authMiddleware then deleteUser', async () => {
      const app = createTestApp();
      const res = await request(app).delete('/api/auth/user/u123').send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: 'deleteUser' });
      expect(authMiddleware).toHaveBeenCalledTimes(1);
      expect(authController.deleteUser).toHaveBeenCalledTimes(1);
      expect(authController.deleteUser).toHaveBeenCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ id: 'u123' }) }),
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe('verify routes (/api/verify)', () => {
    it('GET /verify-email calls verifyEmail', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/verify/verify-email');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: 'verifyEmail' });
      expect(authController.verifyEmail).toHaveBeenCalledTimes(1);
    });

    it('GET /verify-error calls verifyError', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/verify/verify-error');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: 'verifyError' });
      expect(authController.verifyError).toHaveBeenCalledTimes(1);
    });
  });

  describe('internal routes (/api/internal)', () => {
    it('POST /check-email-registered calls checkEmailRegistered', async () => {
      const app = createTestApp();
      const res = await request(app).post('/api/internal/check-email-registered').send({
        email: 'a@b.com',
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: 'checkEmailRegistered' });
      expect(internalController.checkEmailRegistered).toHaveBeenCalledTimes(1);
    });

    it('POST /send-bridge-invite calls sendBridgeInviteEmail', async () => {
      const app = createTestApp();
      const res = await request(app).post('/api/internal/send-bridge-invite').send({
        to: 'a@b.com',
        channelName: 'general',
        inviterName: 'Alice',
        url: 'https://x',
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: 'sendBridgeInviteEmail' });
      expect(internalController.sendBridgeInviteEmail).toHaveBeenCalledTimes(1);
    });
  });
});

