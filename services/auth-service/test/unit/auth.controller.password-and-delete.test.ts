import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/database.js', () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
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
    checkDateHourDiff: vi.fn(() => 0),
  };
});

import prisma from '../../src/config/database.js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { emailQueue } from '../../src/jobs/EmailJob.js';
import * as helper from '../../src/helper.js';
import { createReq, createRes } from '../utils/http.js';
import {
  deleteUser,
  forgetPassword,
  forgetResetPassword,
  resetPassword,
} from '../../src/controllers/auth.controller.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.DELETE_PASS = 'delete-pass';
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Auth Controller Passwords/Delete Testing', () => {
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
      (bcrypt as any).compare.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

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
      (bcrypt as any).compare.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
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
      const req = createReq({
        user: undefined,
        params: { id: 'u2' },
        body: { DELETE_PASS: 'delete-pass' },
      });
      const res = createRes();
      await deleteUser(req as any, res as any);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('returns 403 when delete password invalid', async () => {
      const req = createReq({
        user: { id: 'u1' },
        params: { id: 'u2' },
        body: { DELETE_PASS: 'wrong' },
      });
      const res = createRes();
      await deleteUser(req as any, res as any);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 400 when trying to delete self', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({ id: 'u1' });
      const req = createReq({
        user: { id: 'u1' },
        params: { id: 'u1' },
        body: { DELETE_PASS: 'delete-pass' },
      });
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
      (prisma as any).user.findUnique.mockResolvedValueOnce({ id: 'u2' });
      (prisma as any).channel.findMany.mockResolvedValue([]);
      (prisma as any).workspace.findMany.mockResolvedValue([]);
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
