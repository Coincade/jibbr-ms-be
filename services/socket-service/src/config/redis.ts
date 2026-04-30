import { createClient } from 'redis';

// Build Redis URL from Aiven Valkey environment variables
const buildRedisUrl = (): string => {
  // Debug: Log what env vars are available when this function is called
  console.log('🔍 buildRedisUrl() called with env:', {
    REDIS_URL: process.env.REDIS_URL ? 'SET' : 'NOT SET',
    REDIS_HOST: process.env.REDIS_HOST || 'NOT SET',
    REDIS_PORT: process.env.REDIS_PORT || 'NOT SET',
    REDIS_PASSWORD: process.env.REDIS_PASSWORD ? 'SET' : 'NOT SET',
  });

  // Support both REDIS_URL format and separate host/port/password
  if (process.env.REDIS_URL) {
    console.log('🔗 Using REDIS_URL for WebSocket Redis connection');
    return process.env.REDIS_URL;
  }

  const host = process.env.REDIS_HOST || 'localhost';
  const port = process.env.REDIS_PORT || '6379';
  const password = process.env.REDIS_PASSWORD;

  console.log('🔗 WebSocket Redis config:', {
    host,
    port,
    hasPassword: !!password,
    source: 'Aiven Valkey'
  });

  // Build URL with or without password
  if (password) {
    return `redis://:${password}@${host}:${port}`;
  }
  return `redis://${host}:${port}`;
};

// IMPORTANT: Don't call buildRedisUrl() at module load time
// Instead, call it lazily when createRedisClients is called
let redisUrl: string | null = null;

const getRedisUrl = (): string => {
  if (!redisUrl) {
    redisUrl = buildRedisUrl();
  }
  return redisUrl;
};

// Create Redis clients for Socket.IO adapter (Pub/Sub)
export const createRedisClients = async () => {
  const url = getRedisUrl();
  const pubClient = createClient({
    url: url,
    socket: {
      reconnectStrategy: (retries: number) => {
        if (retries > 10) {
          console.error('❌ Redis connection failed after 10 retries');
          return new Error('Max retries reached');
        }
        const delay = retries * 100;
        console.log(`⏳ Retrying Redis connection (attempt ${retries})`);
        return delay;
      }
    }
  });

  const subClient = pubClient.duplicate();

  pubClient.on('error', (err: Error) => console.error('❌ Redis Pub Error:', err));
  subClient.on('error', (err: Error) => console.error('❌ Redis Sub Error:', err));

  pubClient.on('ready', () => console.log('✅ Redis Publisher ready'));
  subClient.on('ready', () => console.log('✅ Redis Subscriber ready'));

  await Promise.all([pubClient.connect(), subClient.connect()]);

  console.log('✅ Redis clients connected - WebSocket scaling enabled!');

  return { pubClient, subClient };
};

// State client for online users, caching, etc.
export const createStateRedisClient = async () => {
  const url = getRedisUrl();
  const client = createClient({
    url,
    socket: {
      reconnectStrategy: (retries: number) => {
        if (retries > 10) return new Error('Max retries reached');
        const delays = [100, 300, 1000, 3000];
        return delays[Math.min(retries, delays.length - 1)];
      },
    },
  });
  client.on('error', (err: Error) => console.error('❌ Redis State Error:', err));
  await client.connect();
  console.log('✅ Redis State client connected');
  return client;
};

let stateClientPromise: Promise<any> | null = null;
export const getStateRedisClient = async () => {
  if (!stateClientPromise) {
    stateClientPromise = createStateRedisClient().catch((error) => {
      stateClientPromise = null;
      throw error;
    });
  }
  return stateClientPromise;
};

// Stream client for Valkey Streams (socket-service consumers)
export const createStreamRedisClient = async () => {
  const url = getRedisUrl();
  const client = createClient({ url: url });
  client.on('error', (err: Error) => console.error('❌ Redis Stream Error:', err));
  await client.connect();
  console.log('✅ Redis Stream client connected');
  return client;
};


