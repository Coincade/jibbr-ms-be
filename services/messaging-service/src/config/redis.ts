import { createClient } from 'redis';

// Build Redis URL from Aiven Valkey environment variables
const buildRedisUrl = (): string => {
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

const redisUrl = buildRedisUrl();

// Create Redis clients for Socket.IO adapter (Pub/Sub)
export const createRedisClients = async () => {
  // console.log('🔄 Connecting to Redis:', redisUrl.replace(/:[^:@]+@/, ':****@')); // Hide password in logs

  const pubClient = createClient({ 
    url: redisUrl,
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
  const client = createClient({ url: redisUrl });
  client.on('error', (err: Error) => console.error('❌ Redis State Error:', err));
  await client.connect();
  console.log('✅ Redis State client connected');
  return client;
};

