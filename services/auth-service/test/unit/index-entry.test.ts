import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerInfo, loggerError, Logger, createAuthApp, listen, use, mockApp, prismaMock } = vi.hoisted(() => {
  const loggerInfo = vi.fn();
  const loggerError = vi.fn();
  const Logger = class {
    info = loggerInfo;
    error = loggerError;
  };
  const listen = vi.fn((_port: number, _host: string, cb: () => void) => {
    cb();
  });
  const use = vi.fn().mockReturnThis();
  const mockApp = { use, listen };
  const createAuthApp = vi.fn(() => mockApp);
  const prismaMock = {
    $connect: vi.fn().mockResolvedValue(undefined),
  };
  return { loggerInfo, loggerError, Logger, createAuthApp, listen, use, mockApp, prismaMock };
});

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
}));

vi.mock('@jibbr/logger', () => ({
  Logger,
}));

vi.mock('../../src/config/database.js', () => ({
  default: prismaMock,
}));

vi.mock('../../src/app.js', () => ({
  createAuthApp,
}));

vi.mock('../../src/routes/auth.route.js', () => ({
  default: (req: unknown, res: unknown, next: () => void) => next(),
}));

vi.mock('../../src/routes/verify.route.js', () => ({
  default: (req: unknown, res: unknown, next: () => void) => next(),
}));

vi.mock('../../src/routes/internal.route.js', () => ({
  default: (req: unknown, res: unknown, next: () => void) => next(),
}));

vi.mock('../../src/jobs/index.js', () => ({}));

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

describe('index entry (bootstraps server)', () => {
  const originalPort = process.env.PORT;
  const originalAuthPort = process.env.AUTH_PORT;
  let setIntervalHandler: (() => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    vi.setSystemTime(new Date('2020-01-15T12:00:00.000Z'));
    listen.mockClear();
    use.mockClear();
    createAuthApp.mockClear();
    loggerInfo.mockClear();
    loggerError.mockClear();
    prismaMock.$connect.mockClear().mockResolvedValue(undefined);
    setIntervalHandler = undefined;
    vi.spyOn(globalThis, 'setInterval').mockImplementation((fn: TimerHandler) => {
      setIntervalHandler = () => (typeof fn === 'function' ? fn() : undefined);
      return 0 as unknown as NodeJS.Timeout;
    });
    process.env.PORT = '0';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.setSystemTime(new Date());
    vi.restoreAllMocks();
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
    if (originalAuthPort === undefined) delete process.env.AUTH_PORT;
    else process.env.AUTH_PORT = originalAuthPort;
  });

  it('connects prisma, mounts routes, starts listener, and schedules retries', async () => {
    await import('../../src/index.ts');
    await flushAsync();
    expect(prismaMock.$connect).toHaveBeenCalled();
    expect(use).toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith(0, '0.0.0.0', expect.any(Function));
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 10_000);
    expect(createAuthApp).toHaveBeenCalledWith(
      expect.objectContaining({
        isDbConnected: expect.any(Function),
        viewsPath: expect.stringMatching(/[\\/]src[\\/]views$/),
      }),
    );
    const { isDbConnected } = createAuthApp.mock.calls[0][0] as {
      isDbConnected: () => boolean;
    };
    expect(isDbConnected()).toBe(true);
    const connectCallsAfterBoot = prismaMock.$connect.mock.calls.length;
    setIntervalHandler?.();
    await flushAsync();
    expect(prismaMock.$connect).toHaveBeenCalledTimes(connectCallsAfterBoot);
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.stringMatching(/Auth service is running/),
    );
  });

  it('uses default port 3001 when PORT and AUTH_PORT are unset', async () => {
    vi.resetModules();
    delete process.env.PORT;
    delete process.env.AUTH_PORT;
    vi.spyOn(globalThis, 'setInterval').mockImplementation((fn) => {
      return 0 as unknown as NodeJS.Timeout;
    });
    await import('../../src/index.ts');
    await flushAsync();
    expect(listen).toHaveBeenCalledWith(3001, '0.0.0.0', expect.any(Function));
  });

  it('logs throttled error when $connect keeps failing and skips logs within 10s window', async () => {
    prismaMock.$connect.mockRejectedValue(new Error('unreachable'));
    await import('../../src/index.ts');
    await flushAsync();
    const { isDbConnected } = createAuthApp.mock.calls[0][0] as {
      isDbConnected: () => boolean;
    };
    expect(isDbConnected()).toBe(false);
    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalledWith(
      '❌ Database connection failed (check DATABASE_URL / network)',
      expect.any(Error),
    );

    vi.setSystemTime(new Date('2020-01-15T12:00:05.000Z'));
    setIntervalHandler?.();
    await flushAsync();
    expect(loggerError).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2020-01-15T12:00:12.000Z'));
    setIntervalHandler?.();
    await flushAsync();
    expect(loggerError).toHaveBeenCalledTimes(2);
  });

  it('setInterval callback retries and connects when $connect later succeeds', async () => {
    prismaMock.$connect.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(undefined);
    await import('../../src/index.ts');
    await flushAsync();
    expect(setIntervalHandler).toBeDefined();
    setIntervalHandler!();
    await flushAsync();
    expect(prismaMock.$connect).toHaveBeenCalledTimes(2);
    expect(loggerInfo).toHaveBeenCalledWith('✅ Database connected');
  });
});
