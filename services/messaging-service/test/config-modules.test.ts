import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@jibbr/database');
  vi.doUnmock('redis');
  delete process.env.REDIS_URL;
  delete process.env.REDIS_HOST;
  delete process.env.REDIS_PORT;
  delete process.env.REDIS_PASSWORD;
});

describe('config/database', () => {
  it('constructs PrismaClient with expected options', async () => {
    const PrismaClient = vi.fn().mockImplementation(function MockPrisma(this: object) {
      return this;
    });
    vi.doMock('@jibbr/database', () => ({ PrismaClient }));

    const mod = await import('../src/config/database.js');

    expect(PrismaClient).toHaveBeenCalledTimes(1);
    expect(PrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({
        log: ['query', 'info', 'warn', 'error'],
        errorFormat: 'pretty',
      })
    );
    expect(mod.default).toBeDefined();
  });
});

describe('config/streams', () => {
  it('exports expected stream names', async () => {
    const { STREAMS } = await import('../src/config/streams.js');
    expect(STREAMS).toEqual({
      MESSAGES: 'messages',
      NOTIFICATIONS: 'notifications',
      USER_EVENTS: 'user-events',
      WORKSPACE_EVENTS: 'workspace-events',
      CHANNEL_EVENTS: 'channel-events',
    });
  });
});

describe('config/redis', () => {
  it('createStateRedisClient uses REDIS_URL and connects', async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const on = vi.fn();
    const duplicate = vi.fn();
    const createClient = vi.fn(() => ({ connect, on, duplicate }));
    vi.doMock('redis', () => ({ createClient }));
    process.env.REDIS_URL = 'redis://localhost:6379';

    const { createStateRedisClient } = await import('../src/config/redis.js');
    await createStateRedisClient();

    expect(createClient).toHaveBeenCalledWith({ url: 'redis://localhost:6379' });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('createRedisClients builds url from host/port/password and connects both clients', async () => {
    const connectPub = vi.fn().mockResolvedValue(undefined);
    const connectSub = vi.fn().mockResolvedValue(undefined);
    const onPub = vi.fn();
    const onSub = vi.fn();
    const subClient = { connect: connectSub, on: onSub };
    const pubClient = {
      connect: connectPub,
      on: onPub,
      duplicate: vi.fn(() => subClient),
    };
    const createClient = vi.fn(() => pubClient);
    vi.doMock('redis', () => ({ createClient }));
    process.env.REDIS_HOST = 'redis.example';
    process.env.REDIS_PORT = '6380';
    process.env.REDIS_PASSWORD = 'secret';

    const { createRedisClients } = await import('../src/config/redis.js');
    await createRedisClients();

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'redis://:secret@redis.example:6380',
      })
    );
    expect(connectPub).toHaveBeenCalledTimes(1);
    expect(connectSub).toHaveBeenCalledTimes(1);
  });
});
