import Redis from 'ioredis';

let client: Redis | null = null;

export const getRedisClient = (): Redis | null => client;

export const initRedis = (): void => {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[call-service] REDIS_URL not set — room state will not persist across restarts');
    return;
  }
  client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
  client.on('error', (err) => console.error('[call-service] Redis error:', err));
  client.on('connect', () => console.log('[call-service] Redis connected'));
};

export const getRedisHealth = (): {
  configured: boolean;
  connected: boolean;
} => {
  if (!client) {
    return { configured: false, connected: false };
  }
  return {
    configured: true,
    connected: client.status === 'ready',
  };
};

export const closeRedis = async (): Promise<void> => {
  if (client) {
    await client.quit();
    client = null;
  }
};
