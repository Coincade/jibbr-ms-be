import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks (module boundaries) ----
vi.mock('../../src/config/database.js', () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    workspace: { findMany: vi.fn(), delete: vi.fn() },
    reaction: { deleteMany: vi.fn() },
    forwardedMessage: { deleteMany: vi.fn() },
    attachment: { deleteMany: vi.fn() },
    message: { deleteMany: vi.fn() },
    channelMember: { deleteMany: vi.fn() },
    channelInvite: { deleteMany: vi.fn() },
    channel: {
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    member: { deleteMany: vi.fn() },
    conversationParticipant: { deleteMany: vi.fn() },
    conversationReadStatus: { deleteMany: vi.fn() },
    conversation: { deleteMany: vi.fn() },
    userNotification: { deleteMany: vi.fn() },
    userNotificationPreference: { deleteMany: vi.fn() },
  };
  return { default: prisma };
});

vi.mock('bcrypt', () => {
  return {
    default: {
      genSalt: vi.fn(),
      hash: vi.fn(),
      compare: vi.fn(),
    },
  };
});

vi.mock('uuid', () => ({ v4: vi.fn() }));

vi.mock('jsonwebtoken', () => {
  return { default: { sign: vi.fn() } };
});

vi.mock('../../src/jobs/EmailJob.js', () => {
  return {
    emailQueueName: 'emailQueue',
    emailQueue: { add: vi.fn() },
  };
});

vi.mock('../../src/helper.js', async () => {
  const actual: any = await vi.importActual('../../src/helper.js');
  return {
    ...actual,
    renderEmailEjs: vi.fn(async () => '<html />'),
    checkDateHourDiff: vi.fn(() => 0),
  };
});

import prisma from '../../src/config/database.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { emailQueue, emailQueueName } from '../../src/jobs/EmailJob.js';
import * as helper from '../../src/helper.js';

import {
  deleteUser,
  forgetPassword,
  forgetResetPassword,
  getUser,
  login,
  logout,
  register,
  resendVerificationEmail,
  resetPassword,
  verifyEmail,
  verifyError,
} from '../../src/controllers/auth.controller.js';

// ---- Test helpers ----
function createReq(overrides: any = {}) {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    user: undefined,
    ...overrides,
  };
}

function createRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  res.redirect = vi.fn(() => res);
  res.render = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLIENT_APP_URL = 'https://client.example.com';
  process.env.JWT_SECRET = 'test-secret';
  process.env.DELETE_PASS = 'delete-pass';
  process.env.NODE_ENV = 'test';
});

describe('Auth Controller Testing', () => {
  describe('register', () => {
    it('returns 422 when email already exists', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({ id: 'u1' });
      const req = createReq({
        body: {
          name: 'User',
          email: 'user@example.com',
          password: 'Abcdefg1',
          confirmPassword: 'Abcdefg1',
        },
      });
      const res = createRes();

      await register(req as any, res as any);
     
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({
        errors: { email: 'Email already exists' },
      });
      expect((prisma as any).user.create).not.toHaveBeenCalled();
    });

    it('creates user and returns 201 even if email queue fails', async () => {
      (prisma as any).user.findUnique.mockResolvedValue(null);
      (bcrypt as any).genSalt.mockResolvedValue('salt');
      (bcrypt as any).hash.mockResolvedValueOnce('hashed-pass').mockResolvedValueOnce('verify-token');
      (uuidv4 as any).mockReturnValue('uuid');
      (emailQueue.add as any).mockRejectedValue(new Error('redis down'));
      (prisma as any).user.create.mockResolvedValue({ id: 'u2' });

      const req = createReq({
        body: {
          name: 'User',
          email: 'user2@example.com',
          password: 'Abcdefg1',
          confirmPassword: 'Abcdefg1',
        },
      });
      const res = createRes();

      await register(req as any, res as any);

      expect(helper.renderEmailEjs).toHaveBeenCalled();
      expect(emailQueue.add).toHaveBeenCalledWith(emailQueueName, expect.any(Object));
      expect((prisma as any).user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'user2@example.com',
            password: 'hashed-pass',
            email_verify_token: 'verify-token',
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Please check your email to verify your account',
      });
    });

    it('returns 422 for invalid payload', async () => {
      const req = createReq({
        body: {
          name: '',
          email: 'bad-email',
          password: '1',
          confirmPassword: '2',
        },
      });
      const res = createRes();

      await register(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid data' })
      );
    });
  });

  describe('login', () => {
    it('returns 422 when user not found', async () => {
      (prisma as any).user.findUnique.mockResolvedValue(null);
      const req = createReq({ body: { email: 'a@b.com', password: 'Abcdefg1' } });
      const res = createRes();

      await login(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({
        errors: { email: 'No user found with this email' },
      });
    });

    it('returns 422 when password is invalid', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({
        id: 'u1',
        name: 'U',
        email: 'a@b.com',
        password: 'hash',
        email_verified_at: new Date().toISOString(),
      });
      (bcrypt as any).compare.mockResolvedValue(false);
      const req = createReq({ body: { email: 'a@b.com', password: 'Abcdefg1' } });
      const res = createRes();

      await login(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({
        errors: { email: 'Invalid email or password' },
      });
    });

    it('returns 403 when email is not verified', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({
        id: 'u1',
        name: 'U',
        email: 'a@b.com',
        password: 'hash',
        email_verified_at: null,
      });
      (bcrypt as any).compare.mockResolvedValue(true);
      const req = createReq({ body: { email: 'a@b.com', password: 'Abcdefg1' } });
      const res = createRes();
      
      

      await login(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Please verify your email' })
      );
    });

    it('returns 200 and bearer token on success', async () => {
      const verifiedAt = new Date().toISOString();
      (prisma as any).user.findUnique.mockResolvedValue({
        id: 'u1',
        name: 'U',
        email: 'a@b.com',
        password: 'hash',
        email_verified_at: verifiedAt,
        email_verify_token: null,
      });
      (bcrypt as any).compare.mockResolvedValue(true);
      (jwt as any).sign.mockReturnValue('jwt-token');

      const req = createReq({ body: { email: 'a@b.com', password: 'Abcdefg1' } });
      const res = createRes();

      await login(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Logged in successfully',
          data: expect.objectContaining({
            token: 'Bearer jwt-token',
            emailVerified: true,
            emailVerifiedAt: verifiedAt,
          }),
        })
      );
    });

    it('returns 500 on unexpected error', async () => {
      (prisma as any).user.findUnique.mockRejectedValue(new Error('db fail'));
      const req = createReq({ body: { email: 'a@b.com', password: 'Abcdefg1' } });
      const res = createRes();

      await login(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Internal server error' })
      );
    });
  });

  describe('logout', () => {
    it('sends success message', async () => {
      const req = createReq();
      const res = createRes();
      await logout(req as any, res as any);
      expect(res.send).toHaveBeenCalledWith('Logged out successfully!');
    });
  });

  describe('getUser', () => {
    it('returns 422 when req.user is missing', async () => {
      const req = createReq({ user: undefined });
      const res = createRes();
      await getUser(req as any, res as any);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ message: 'User Not Found' });
    });

    it('returns 200 with user data', async () => {
      const req = createReq({ user: { id: 'u1' } });
      const res = createRes();
      await getUser(req as any, res as any);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: { id: 'u1' } });
    });
  });

  describe('verifyError', () => {
    it('renders verify error page', async () => {
      const req = createReq();
      const res = createRes();
      await verifyError(req as any, res as any);
      expect(res.render).toHaveBeenCalledWith('auth/emailVerifyError');
    });
  });

  describe('verifyEmail', () => {
    it('returns 400 json when email missing (api request)', async () => {
      const req = createReq({
        query: { token: 't', format: 'json' },
        headers: { accept: 'application/json' },
      });
      const res = createRes();

      await verifyEmail(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Email is required' })
      );
    });

    it('returns 404 json when user not found (api request)', async () => {
      (prisma as any).user.findUnique.mockResolvedValue(null);
      const req = createReq({
        query: { email: 'a@b.com', token: 't', format: 'json' },
        headers: { accept: 'application/json' },
      });
      const res = createRes();

      await verifyEmail(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User not found' })
      );
    });

    it('returns 422 json when token mismatch (api request)', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({
        email_verified_at: null,
        email_verify_token: 'correct',
        email_verify_token_sent_at: new Date(),
      });
      const req = createReq({
        query: { email: 'a@b.com', token: 'wrong', format: 'json' },
        headers: { accept: 'application/json' },
      });
      const res = createRes();

      await verifyEmail(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid verification token' })
      );
    });

    it('returns 422 json when verification link expired (api request)', async () => {
      (helper.checkDateHourDiff as any).mockReturnValue(3);
      (prisma as any).user.findUnique.mockResolvedValue({
        email_verified_at: null,
        email_verify_token: 't',
        email_verify_token_sent_at: new Date(),
      });
      const req = createReq({
        query: { email: 'a@b.com', token: 't', format: 'json' },
        headers: { accept: 'application/json' },
      });
      const res = createRes();

      await verifyEmail(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Verification link expired' })
      );
    });

    it('updates user and returns 200 json on success (api request)', async () => {
      (helper.checkDateHourDiff as any).mockReturnValue(1);
      (prisma as any).user.findUnique.mockResolvedValue({
        email_verified_at: null,
        email_verify_token: 't',
        email_verify_token_sent_at: new Date(),
      });
      (prisma as any).user.update.mockResolvedValue({});

      const req = createReq({
        query: { email: 'a@b.com', token: 't', format: 'json' },
        headers: { accept: 'application/json' },
      });
      const res = createRes();

      await verifyEmail(req as any, res as any);

      expect((prisma as any).user.update).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Email verified successfully' })
      );
    });

    it('redirects to already-verified route for non-api request', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({
        email_verified_at: new Date().toISOString(),
      });
      const req = createReq({
        query: { email: 'a@b.com', token: 't' },
        headers: { accept: 'text/html' },
      });
      const res = createRes();

      await verifyEmail(req as any, res as any);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/verify-email?already_verified=1')
      );
    });

    it('redirects to success page for non-api success', async () => {
      (helper.checkDateHourDiff as any).mockReturnValue(1);
      (prisma as any).user.findUnique.mockResolvedValue({
        email_verified_at: null,
        email_verify_token: 't',
        email_verify_token_sent_at: new Date(),
      });
      (prisma as any).user.update.mockResolvedValue({});
      const req = createReq({
        query: { email: 'a@b.com', token: 't' },
        headers: { accept: 'text/html' },
      });
      const res = createRes();

      await verifyEmail(req as any, res as any);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/verify-email?email=')
      );
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('verified=1')
      );
    });

    it('returns 500 json for api request on unexpected error', async () => {
      (prisma as any).user.findUnique.mockRejectedValue(new Error('db fail'));
      const req = createReq({
        query: { email: 'a@b.com', token: 't', format: 'json' },
        headers: { accept: 'application/json' },
      });
      const res = createRes();

      await verifyEmail(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Internal server error' })
      );
    });
  });

  describe('resendVerificationEmail', () => {
    it('returns 422 when email missing', async () => {
      const req = createReq({ body: {} });
      const res = createRes();
      await resendVerificationEmail(req as any, res as any);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('returns 422 when user not found', async () => {
      (prisma as any).user.findUnique.mockResolvedValue(null);
      const req = createReq({ body: { email: 'a@b.com' } });
      const res = createRes();
      await resendVerificationEmail(req as any, res as any);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User not found' })
      );
    });

    it('returns 422 when user already verified', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({
        name: 'U',
        email_verified_at: new Date().toISOString(),
      });
      const req = createReq({ body: { email: 'a@b.com' } });
      const res = createRes();
      await resendVerificationEmail(req as any, res as any);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Email already verified' })
      );
    });

    it('updates token and returns 200 even if email queue fails', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({
        name: 'U',
        email_verified_at: null,
      });
      (bcrypt as any).genSalt.mockResolvedValue('salt');
      (bcrypt as any).hash.mockResolvedValue('new-token');
      (uuidv4 as any).mockReturnValue('uuid');
      (prisma as any).user.update.mockResolvedValue({});
      (emailQueue.add as any).mockRejectedValue(new Error('redis down'));

      const req = createReq({ body: { email: 'a@b.com' } });
      const res = createRes();
      await resendVerificationEmail(req as any, res as any);

      expect((prisma as any).user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email_verify_token: 'new-token',
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Verification email sent' });
    });
  });

  describe('forgetPassword', () => {
    it('returns 422 when user not found', async () => {
      (prisma as any).user.findUnique.mockResolvedValue(null);
      const req = createReq({ body: { email: 'a@b.com' } });
      const res = createRes();
      await forgetPassword(req as any, res as any);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User not found' })
      );
    });

    it('returns 429 when rate limited (<2 hours)', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({
        token_send_at: new Date().toISOString(),
      });
      (helper.checkDateHourDiff as any).mockReturnValue(0.5);
      const req = createReq({ body: { email: 'a@b.com' } });
      const res = createRes();

      await forgetPassword(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Please wait 2 hours') })
      );
    });

    it('updates reset token and returns 200 even if email queue fails', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({
        token_send_at: null,
      });
      (bcrypt as any).genSalt.mockResolvedValue('salt');
      (bcrypt as any).hash.mockResolvedValue('reset-token');
      (uuidv4 as any).mockReturnValue('uuid');
      (prisma as any).user.update.mockResolvedValue({});
      (emailQueue.add as any).mockRejectedValue(new Error('redis down'));

      const req = createReq({ body: { email: 'a@b.com' } });
      const res = createRes();

      await forgetPassword(req as any, res as any);

      expect((prisma as any).user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            password_reset_token: 'reset-token',
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Password reset email sent' });
    });
  });

  describe('forgetResetPassword', () => {
    it('returns 422 when user not found', async () => {
      (prisma as any).user.findUnique.mockResolvedValue(null);
      const req = createReq({
        body: {
          email: 'a@b.com',
          token: 't',
          password: 'Abcdefg1',
          confirmPassword: 'Abcdefg1',
        },
      });
      const res = createRes();

      await forgetResetPassword(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User not found' })
      );
    });

    it('returns 422 when token is invalid', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({
        password_reset_token: 'correct',
        token_send_at: new Date().toISOString(),
      });
      const req = createReq({
        body: {
          email: 'a@b.com',
          token: 'wrong',
          password: 'Abcdefg1',
          confirmPassword: 'Abcdefg1',
        },
      });
      const res = createRes();

      await forgetResetPassword(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('returns 422 when token expired (>2 hours)', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({
        password_reset_token: 't',
        token_send_at: new Date().toISOString(),
      });
      (helper.checkDateHourDiff as any).mockReturnValue(3);
      const req = createReq({
        body: {
          email: 'a@b.com',
          token: 't',
          password: 'Abcdefg1',
          confirmPassword: 'Abcdefg1',
        },
      });
      const res = createRes();

      await forgetResetPassword(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Token expired' })
      );
    });

    it('updates password and clears token on success', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({
        password_reset_token: 't',
        token_send_at: new Date().toISOString(),
      });
      (helper.checkDateHourDiff as any).mockReturnValue(1);
      (bcrypt as any).genSalt.mockResolvedValue('salt');
      (bcrypt as any).hash.mockResolvedValue('new-pass-hash');
      (prisma as any).user.update.mockResolvedValue({});

      const req = createReq({
        body: {
          email: 'a@b.com',
          token: 't',
          password: 'Abcdefg1',
          confirmPassword: 'Abcdefg1',
        },
      });
      const res = createRes();

      await forgetResetPassword(req as any, res as any);

      expect((prisma as any).user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            password: 'new-pass-hash',
            password_reset_token: null,
            token_send_at: null,
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('resetPassword', () => {
    it('returns 422 when user not found', async () => {
      (prisma as any).user.findUnique.mockResolvedValue(null);
      const req = createReq({
        body: {
          email: 'a@b.com',
          currentPassword: 'Abcdefg1',
          password: 'Abcdefg2',
          confirmPassword: 'Abcdefg2',
        },
      });
      const res = createRes();

      await resetPassword(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User not found' })
      );
    });

    it('returns 422 when current password incorrect', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({ password: 'hash' });
      (bcrypt as any).compare.mockResolvedValue(false);
      const req = createReq({
        body: {
          email: 'a@b.com',
          currentPassword: 'Abcdefg1',
          password: 'Abcdefg2',
          confirmPassword: 'Abcdefg2',
        },
      });
      const res = createRes();

      await resetPassword(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Current password is incorrect' })
      );
    });

    it('returns 422 when new password is same as current', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({ password: 'hash' });
      (bcrypt as any).compare
        .mockResolvedValueOnce(true) // current password valid
        .mockResolvedValueOnce(true); // new password same

      const req = createReq({
        body: {
          email: 'a@b.com',
          currentPassword: 'Abcdefg1',
          password: 'Abcdefg1',
          confirmPassword: 'Abcdefg1',
        },
      });
      const res = createRes();

      await resetPassword(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'New password must be different from current password',
        })
      );
    });

    it('updates password and returns 200 on success', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({ password: 'hash' });
      (bcrypt as any).compare
        .mockResolvedValueOnce(true) // current password valid
        .mockResolvedValueOnce(false); // new password different
      (bcrypt as any).genSalt.mockResolvedValue('salt');
      (bcrypt as any).hash.mockResolvedValue('new-hash');
      (prisma as any).user.update.mockResolvedValue({});

      const req = createReq({
        body: {
          email: 'a@b.com',
          currentPassword: 'Abcdefg1',
          password: 'Abcdefg2',
          confirmPassword: 'Abcdefg2',
        },
      });
      const res = createRes();

      await resetPassword(req as any, res as any);

      expect((prisma as any).user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { password: 'new-hash' },
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Password changed successfully' });
    });

    it('returns 422 when confirm password does not match', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({ password: 'hash' });
      (bcrypt as any).compare.mockResolvedValue(true);
      const req = createReq({
        body: {
          email: 'a@b.com',
          currentPassword: 'Abcdefg1',
          password: 'Abcdefg2',
          confirmPassword: 'Abcdefg3',
        },
      });
      const res = createRes();

      await resetPassword(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid data' })
      );
    });
  });

  describe('deleteUser', () => {
    it('returns 422 when req.user missing', async () => {
      const req = createReq({ user: undefined, params: { id: 'u2' }, body: { DELETE_PASS: 'delete-pass' } });
      const res = createRes();
      await deleteUser(req as any, res as any);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('returns 403 when delete password invalid', async () => {
      const req = createReq({ user: { id: 'u1' }, params: { id: 'u2' }, body: { DELETE_PASS: 'wrong' } });
      const res = createRes();
      await deleteUser(req as any, res as any);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 400 when trying to delete self', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({ id: 'u1' }); // userToDelete exists
      const req = createReq({ user: { id: 'u1' }, params: { id: 'u1' }, body: { DELETE_PASS: 'delete-pass' } });
      const res = createRes();
      await deleteUser(req as any, res as any);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when user to delete does not exist', async () => {
      (prisma as any).user.findUnique.mockResolvedValue(null);
      const req = createReq({
        user: { id: 'u1' },
        params: { id: 'u2' },
        body: { DELETE_PASS: 'delete-pass' },
      });
      const res = createRes();

      await deleteUser(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'User not found' });
    });

    it('deletes user and returns 200 on happy path (no workspaces)', async () => {
      (prisma as any).user.findUnique.mockResolvedValueOnce({ id: 'u2' }); // userToDelete
      (prisma as any).channel.findMany.mockResolvedValue([]); // channelsWhereUserIsAdmin
      (prisma as any).workspace.findMany.mockResolvedValue([]); // userWorkspaces
      (prisma as any).user.delete.mockResolvedValue({});

      const req = createReq({
        user: { id: 'u1' },
        params: { id: 'u2' },
        body: { DELETE_PASS: 'delete-pass' },
      });
      const res = createRes();

      await deleteUser(req as any, res as any);

      expect((prisma as any).reaction.deleteMany).toHaveBeenCalled();
      expect((prisma as any).member.deleteMany).toHaveBeenCalled();
      expect((prisma as any).user.delete).toHaveBeenCalledWith({ where: { id: 'u2' } });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ deletedUserId: 'u2' })
      );
    });

    it('handles admin transfer, channel delete, workspace cascade and returns 200', async () => {
      (prisma as any).user.findUnique
        .mockResolvedValueOnce({ id: 'u2' })
        .mockResolvedValueOnce({ id: 'creator-1' })
        .mockResolvedValueOnce(null);

      (prisma as any).channel.findMany.mockResolvedValue([
        { id: 'ch-1', workspace: { userId: 'creator-1' } },
        { id: 'ch-2', workspace: { userId: 'creator-missing' } },
      ]);
      (prisma as any).workspace.findMany.mockResolvedValue([{ id: 'w1' }]);
      (prisma as any).user.delete.mockResolvedValue({});

      const req = createReq({
        user: { id: 'u1' },
        params: { id: 'u2' },
        body: { DELETE_PASS: 'delete-pass' },
      });
      const res = createRes();

      await deleteUser(req as any, res as any);

      expect((prisma as any).channel.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ch-1' } })
      );
      expect((prisma as any).channel.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ch-2' } })
      );
      expect((prisma as any).workspace.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'w1' } })
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 500 when delete operation throws', async () => {
      (prisma as any).user.findUnique.mockRejectedValue(new Error('db fail'));
      const req = createReq({
        user: { id: 'u1' },
        params: { id: 'u2' },
        body: { DELETE_PASS: 'delete-pass' },
      });
      const res = createRes();

      await deleteUser(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: 'Internal server error' });
    });
  });
});

