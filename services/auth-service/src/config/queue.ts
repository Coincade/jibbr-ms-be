import { ConnectionOptions, DefaultJobOptions } from "bullmq";

// Support both REDIS_URL and separate host/port/password for Aiven Valkey
const getRedisConfig = () => {
  if (process.env.REDIS_URL) {
    console.log('🔗 Using REDIS_URL for BullMQ connection');
    return { url: process.env.REDIS_URL };
  }
  
  const host = process.env.REDIS_HOST || "localhost";
  const port = parseInt(process.env.REDIS_PORT || "6379");
  const password = process.env.REDIS_PASSWORD;
  
  console.log('🔗 BullMQ Redis config:', {
    host,
    port,
    hasPassword: !!password,
    source: 'Aiven Valkey'
  });
  
  return { host, port, password };
};

const redisConfig = getRedisConfig();

export const redisConnection: ConnectionOptions = {
  ...redisConfig,
  // Add retry strategy for better connection handling
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  // Suppress Redis warnings
  lazyConnect: true,
  // Add connection event handlers
  enableReadyCheck: true,
};

export const defaultQueueOptions: DefaultJobOptions = {
  removeOnComplete: {
    age: 60 * 60, // 1 hour
    count: 20,
  },
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 3000    
  },
  removeOnFail: false,
};

// Queue configuration options
export const queueOptions = {
  connection: redisConnection,
  defaultJobOptions: defaultQueueOptions,
  // Add queue-specific settings
  settings: {
    stalledInterval: 30000, // 30 seconds
    maxStalledCount: 1,
  }
};