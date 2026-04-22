import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(async () => {
  vi.resetModules();
  vi.doUnmock('@jibbr/database');
  vi.doUnmock('nodemailer');
});

describe('config/database', () => {
  it('constructs PrismaClient with expected options', async () => {
    const PrismaClient = vi.fn().mockImplementation(function MockPrisma(this: object) {
      return this;
    });
    vi.doMock('@jibbr/database', () => ({ PrismaClient }));
    const mod = await import('../../src/config/database.js');
    expect(PrismaClient).toHaveBeenCalledTimes(1);
    expect(PrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({
        log: ['query', 'info', 'warn', 'error'],
        errorFormat: 'pretty',
      }),
    );
    expect(mod.default).toBeDefined();
  });
});

describe('config/queue', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.REDIS_PASSWORD;
  });

  it('uses REDIS_URL when set', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const { redisConnection } = await import('../../src/config/queue.js');
    expect(redisConnection).toEqual(
      expect.objectContaining({
        url: 'redis://localhost:6379',
        lazyConnect: true,
      }),
    );
  });

  it('uses host, port, and password when REDIS_URL is unset', async () => {
    delete process.env.REDIS_URL;
    process.env.REDIS_HOST = 'redis.example';
    process.env.REDIS_PORT = '6380';
    process.env.REDIS_PASSWORD = 'secret';
    const { redisConnection } = await import('../../src/config/queue.js');
    expect(redisConnection).toEqual(
      expect.objectContaining({
        host: 'redis.example',
        port: 6380,
        password: 'secret',
        lazyConnect: true,
      }),
    );
  });
});

describe('config/rateLimit', () => {
  it('exports limiter middleware factories', async () => {
    const { appLimiter, authLimiter } = await import('../../src/config/rateLimit.js');
    expect(typeof appLimiter).toBe('function');
    expect(typeof authLimiter).toBe('function');
  });
});

describe('config/mail', () => {
  const sendMail = vi.fn();
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sendMail.mockReset();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('sendEmail creates transporter and sends mail', async () => {
    sendMail.mockResolvedValue({ messageId: 'abc' });
    vi.doMock('nodemailer', () => ({
      default: {
        createTransport: vi.fn(() => ({ sendMail })),
      },
    }));
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASSWORD = 'p';
    process.env.FROM_EMAIL = 'from@test.dev';
    const { sendEmail } = await import('../../src/config/mail.js');
    const info = await sendEmail('to@test.dev', 'Subject', '<p>hi</p>');
    expect(info).toEqual({ messageId: 'abc' });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'to@test.dev',
        subject: 'Subject',
        html: '<p>hi</p>',
      }),
    );
  });

  it('sendEmail rethrows when sendMail fails', async () => {
    sendMail.mockRejectedValue(new Error('smtp failed'));
    vi.doMock('nodemailer', () => ({
      default: {
        createTransport: vi.fn(() => ({ sendMail })),
      },
    }));
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASSWORD = 'p';
    process.env.FROM_EMAIL = 'from@test.dev';
    const { sendEmail } = await import('../../src/config/mail.js');
    await expect(sendEmail('to@test.dev', 'S', 'b')).rejects.toThrow('smtp failed');
  });

  it('mailHelper sends via Gmail-style transport', async () => {
    sendMail.mockResolvedValue({});
    vi.doMock('nodemailer', () => ({
      default: {
        createTransport: vi.fn(() => ({ sendMail })),
      },
    }));
    process.env.GMAIL_HOST = 'smtp.gmail.com';
    process.env.GMAIL_USER = 'guser';
    process.env.GMAIL_PASS = 'gpass';
    const { mailHelper } = await import('../../src/config/mail.js');
    await mailHelper('to@test.dev', 'Sub', '<html/>');
    expect(sendMail).toHaveBeenCalled();
  });

  it('mailHelper rethrows when send fails', async () => {
    sendMail.mockRejectedValue(new Error('gmail down'));
    vi.doMock('nodemailer', () => ({
      default: {
        createTransport: vi.fn(() => ({ sendMail })),
      },
    }));
    process.env.GMAIL_HOST = 'smtp.gmail.com';
    process.env.GMAIL_USER = 'guser';
    process.env.GMAIL_PASS = 'gpass';
    const { mailHelper } = await import('../../src/config/mail.js');
    await expect(mailHelper('to@test.dev', 'S', 'b')).rejects.toThrow('gmail down');
  });
});
