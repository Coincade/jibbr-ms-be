import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  loggerInfo,
  loggerError,
  Logger,
  createMessagingApp,
  use,
  get,
  listen,
  createServer,
  prismaMock,
  initMembershipOutbox,
  startMembershipOutboxRelay,
  startMembershipOutboxCleanup,
} = vi.hoisted(() => {
  const loggerInfo = vi.fn();
  const loggerError = vi.fn();
  const Logger = class {
    info = loggerInfo;
    error = loggerError;
  };
  const use = vi.fn().mockReturnThis();
  const get = vi.fn().mockReturnThis();
  const listen = vi.fn((...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb();
  });
  const createServer = vi.fn(() => ({ listen }));
  const createMessagingApp = vi.fn(() => ({ use, get }));
  const prismaMock = { $connect: vi.fn().mockResolvedValue(undefined) };
  const initMembershipOutbox = vi.fn().mockResolvedValue(undefined);
  const startMembershipOutboxRelay = vi.fn();
  const startMembershipOutboxCleanup = vi.fn();
  return {
    loggerInfo,
    loggerError,
    Logger,
    createMessagingApp,
    use,
    get,
    listen,
    createServer,
    prismaMock,
    initMembershipOutbox,
    startMembershipOutboxRelay,
    startMembershipOutboxCleanup,
  };
});

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('http', () => ({ createServer }));
vi.mock('@jibbr/logger', () => ({ Logger }));
vi.mock('../src/config/database.js', () => ({ default: prismaMock }));
vi.mock('../src/app.js', () => ({ createMessagingApp }));
vi.mock('../src/routes/message.route.js', () => ({ default: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock('../src/routes/channel.route.js', () => ({ default: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock('../src/routes/conversation.route.js', () => ({ default: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock('../src/routes/workspace.route.js', () => ({ default: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock('../src/routes/user.route.js', () => ({ default: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock('../src/routes/notification.route.js', () => ({ default: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock('../src/routes/recents.route.js', () => ({ default: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock('../src/routes/search.route.js', () => ({ default: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock('../src/routes/workspace-collaboration.route.js', () => ({ default: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock('../src/routes/collaboration-group.route.js', () => ({ default: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock('../src/services/membership-outbox.service.js', () => ({
  initMembershipOutbox,
  startMembershipOutboxRelay,
  startMembershipOutboxCleanup,
  getMembershipOutboxStats: vi.fn(),
}));

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

describe('messaging index entry (bootstraps server)', () => {
  const originalPort = process.env.PORT;
  const originalMessagingPort = process.env.MESSAGING_PORT;

  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    listen.mockClear();
    createServer.mockClear();
    use.mockClear();
    get.mockClear();
    createMessagingApp.mockClear();
    loggerInfo.mockClear();
    loggerError.mockClear();
    prismaMock.$connect.mockClear().mockResolvedValue(undefined);
    initMembershipOutbox.mockClear().mockResolvedValue(undefined);
    startMembershipOutboxRelay.mockClear();
    startMembershipOutboxCleanup.mockClear();
    process.env.PORT = '0';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
    if (originalMessagingPort === undefined) delete process.env.MESSAGING_PORT;
    else process.env.MESSAGING_PORT = originalMessagingPort;
  });

  it('mounts routes, starts server, connects db, and starts outbox workers', async () => {
    await import('../src/index.ts');
    await flushAsync();

    expect(createMessagingApp).toHaveBeenCalledWith(
      expect.objectContaining({
        isDbConnected: expect.any(Function),
      })
    );
    expect(use).toHaveBeenCalled();
    expect(createServer).toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith('0', expect.any(Function));
    expect(prismaMock.$connect).toHaveBeenCalled();
    expect(initMembershipOutbox).toHaveBeenCalled();
    expect(startMembershipOutboxRelay).toHaveBeenCalled();
    expect(startMembershipOutboxCleanup).toHaveBeenCalled();
  });

  it('uses default port 3003 when PORT and MESSAGING_PORT are unset', async () => {
    delete process.env.PORT;
    delete process.env.MESSAGING_PORT;
    await import('../src/index.ts');
    await flushAsync();
    expect(listen).toHaveBeenCalledWith(3003, expect.any(Function));
  });
});
