import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/database.js', () => ({
  default: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('../../src/helper.js', () => ({
  renderEmailEjs: vi.fn(async () => '<html>bridge</html>'),
}));

vi.mock('../../src/jobs/EmailJob.js', () => ({
  emailQueueName: 'emailQueue',
  emailQueue: { add: vi.fn() },
}));

import prisma from '../../src/config/database.js';
import { renderEmailEjs } from '../../src/helper.js';
import { emailQueue, emailQueueName } from '../../src/jobs/EmailJob.js';
import { createRes } from '../utils/http.js';
import {
  checkEmailRegistered,
  sendBridgeInviteEmail,
} from '../../src/controllers/internal.controller.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Internal Controller Testing', () => {
  describe('checkEmailRegistered', () => {
    it('returns 400 when email is missing', async () => {
      const req = { body: {} } as any;
      const res = createRes();
      await checkEmailRegistered(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        registered: false,
        message: 'Email is required',
      });
      expect((prisma as any).user.findUnique).not.toHaveBeenCalled();
    });

    it('returns 400 when email is only whitespace after trim', async () => {
      const req = { body: { email: '   ' } } as any;
      const res = createRes();
      await checkEmailRegistered(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('trims and lowercases email before lookup', async () => {
      (prisma as any).user.findUnique.mockResolvedValue(null);
      const req = { body: { email: '  User@Example.COM  ' } } as any;
      const res = createRes();
      await checkEmailRegistered(req, res);
      expect((prisma as any).user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
        select: { id: true },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ registered: false });
    });

    it('returns 200 with registered false when user not found', async () => {
      (prisma as any).user.findUnique.mockResolvedValue(null);
      const req = { body: { email: 'nobody@example.com' } } as any;
      const res = createRes();
      await checkEmailRegistered(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ registered: false });
    });

    it('returns 200 with registered true when user exists', async () => {
      (prisma as any).user.findUnique.mockResolvedValue({ id: 'u1' });
      const req = { body: { email: 'exists@example.com' } } as any;
      const res = createRes();
      await checkEmailRegistered(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ registered: true });
    });

    it('returns 500 when prisma throws', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (prisma as any).user.findUnique.mockRejectedValue(new Error('db down'));
      const req = { body: { email: 'a@b.com' } } as any;
      const res = createRes();
      await checkEmailRegistered(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        registered: false,
        message: 'Internal server error',
      });
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('treats non-string email as missing', async () => {
      const req = { body: { email: 123 } } as any;
      const res = createRes();
      await checkEmailRegistered(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('sendBridgeInviteEmail', () => {
    const validBody = {
      to: 'invitee@example.com',
      channelName: 'general',
      inviterName: 'Alice',
      url: 'https://app.example.com/join',
    };

    it('returns 400 when to is missing', async () => {
      const req = { body: { ...validBody, to: undefined } } as any;
      const res = createRes();
      await sendBridgeInviteEmail(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Missing required fields: to, channelName, inviterName, url',
      });
      expect(renderEmailEjs).not.toHaveBeenCalled();
    });

    it('returns 400 when channelName is missing', async () => {
      const req = { body: { ...validBody, channelName: '' } } as any;
      const res = createRes();
      await sendBridgeInviteEmail(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when inviterName is missing', async () => {
      const req = { body: { ...validBody, inviterName: null } } as any;
      const res = createRes();
      await sendBridgeInviteEmail(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when url is missing', async () => {
      const req = { body: { ...validBody, url: undefined } } as any;
      const res = createRes();
      await sendBridgeInviteEmail(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('renders template, queues email, returns 200', async () => {
      (emailQueue.add as any).mockResolvedValue(undefined);
      const req = { body: validBody } as any;
      const res = createRes();
      await sendBridgeInviteEmail(req, res);

      expect(renderEmailEjs).toHaveBeenCalledWith('bridge-invite', {
        inviteeName: 'invitee',
        channelName: 'general',
        inviterName: 'Alice',
        url: validBody.url,
      });
      expect(emailQueue.add).toHaveBeenCalledWith(emailQueueName, {
        to: validBody.to,
        subject: `Jibbr | You're invited to Bridge Channel: general`,
        body: '<html>bridge</html>',
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Email queued successfully' });
    });

    it('uses "there" as inviteeName when email has no @ local part', async () => {
      (emailQueue.add as any).mockResolvedValue(undefined);
      const req = {
        body: { ...validBody, to: '@nodomain.com' },
      } as any;
      const res = createRes();
      await sendBridgeInviteEmail(req, res);
      expect(renderEmailEjs).toHaveBeenCalledWith(
        'bridge-invite',
        expect.objectContaining({ inviteeName: 'there' })
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 500 when renderEmailEjs throws', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (renderEmailEjs as any).mockRejectedValueOnce(new Error('template missing'));
      const req = { body: validBody } as any;
      const res = createRes();
      await sendBridgeInviteEmail(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: 'Internal server error' });
      errSpy.mockRestore();
    });

    it('returns 500 when email queue add fails', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (emailQueue.add as any).mockRejectedValue(new Error('redis down'));
      const req = { body: validBody } as any;
      const res = createRes();
      await sendBridgeInviteEmail(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: 'Internal server error' });
      errSpy.mockRestore();
    });
  });
});
