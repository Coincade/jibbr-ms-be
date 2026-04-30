import { beforeEach, describe, expect, it, vi } from 'vitest';

const PrismaClient = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());

vi.mock('@jibbr/database', () => ({ PrismaClient }));
vi.mock('redis', () => ({ createClient }));

describe('config modules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('database initializes Prisma with tuned URL', async () => {
    process.env.DATABASE_URL = 'postgres://db';
    await import('../src/config/database.js');
    expect(PrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({
        datasources: {
          db: {
            url: expect.stringContaining('connection_limit=5'),
          },
        },
      })
    );
  });

  it('redis createStateRedisClient uses REDIS_URL', async () => {
    const on = vi.fn();
    const connect = vi.fn(async () => undefined);
    createClient.mockReturnValue({ on, connect });
    process.env.REDIS_URL = 'redis://example';
    const mod = await import('../src/config/redis.js');
    await mod.createStateRedisClient();
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'redis://example' })
    );
    expect(connect).toHaveBeenCalled();
  });
});
