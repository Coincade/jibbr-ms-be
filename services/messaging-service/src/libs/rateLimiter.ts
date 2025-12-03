// [mentions] Redis-based token bucket rate limiter for special mentions (@channel, @here, @everyone)
import { createStateRedisClient } from '../config/redis.js';

let redisClient: any = null;

/**
 * Initialize Redis client for rate limiting
 */
async function getRedisClient() {
  if (!redisClient) {
    try {
      redisClient = await createStateRedisClient();
    } catch (error) {
      console.error('[mentions] Failed to initialize Redis for rate limiting:', error);
      // Fallback to in-memory (not ideal for distributed systems)
      return null;
    }
  }
  return redisClient;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Token bucket rate limiter for special mentions
 * @param key - Unique key (e.g., `userId:channelId`)
 * @param maxTokens - Maximum tokens per window
 * @param windowSec - Time window in seconds
 */
export async function checkSpecialMentionRateLimit(
  key: string,
  maxTokens: number = 1,
  windowSec: number = 120
): Promise<RateLimitResult> {
  const client = await getRedisClient();
  if (!client) {
    // No Redis - allow (not ideal, but graceful degradation)
    return { allowed: true, remaining: maxTokens, resetAt: Date.now() + windowSec * 1000 };
  }

  const redisKey = `mention:rate_limit:${key}`;
  const now = Date.now();
  const windowMs = windowSec * 1000;

  try {
    // Get current token count
    const current = await client.get(redisKey);
    const tokens = current ? parseInt(current, 10) : maxTokens;

    if (tokens <= 0) {
      // Check TTL to get reset time
      const ttl = await client.ttl(redisKey);
      return {
        allowed: false,
        remaining: 0,
        resetAt: now + (ttl > 0 ? ttl * 1000 : windowMs)
      };
    }

    // Consume a token
    const multi = client.multi();
    multi.decr(redisKey);
    multi.expire(redisKey, windowSec);
    await multi.exec();

    return {
      allowed: true,
      remaining: tokens - 1,
      resetAt: now + windowMs
    };
  } catch (error) {
    console.error('[mentions] Rate limit check failed:', error);
    // On error, allow (graceful degradation)
    return { allowed: true, remaining: maxTokens, resetAt: now + windowMs };
  }
}

/**
 * Reset rate limit for a key (for testing/admin)
 */
export async function resetRateLimit(key: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.del(`mention:rate_limit:${key}`);
  } catch (error) {
    console.error('[mentions] Rate limit reset failed:', error);
  }
}

