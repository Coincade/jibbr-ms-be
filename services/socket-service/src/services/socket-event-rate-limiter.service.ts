type EventType = 'message' | 'typing' | 'presence';

import { getStateRedisClient } from '../config/redis.js';
import { realtimeMetrics } from './realtime-observability.service.js';

type Counter = {
  count: number;
  resetAt: number;
};

const counters = new Map<string, Counter>();
const STRICT_REDIS = process.env.SOCKET_RATE_LIMIT_STRICT_REDIS === '1';

const parsePositiveInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const limits: Record<EventType, { max: number; windowMs: number }> = {
  message: {
    max: parsePositiveInt('SOCKET_RATE_LIMIT_MESSAGE_MAX', 60),
    windowMs: parsePositiveInt('SOCKET_RATE_LIMIT_MESSAGE_WINDOW_MS', 60_000),
  },
  typing: {
    max: parsePositiveInt('SOCKET_RATE_LIMIT_TYPING_MAX', 120),
    windowMs: parsePositiveInt('SOCKET_RATE_LIMIT_TYPING_WINDOW_MS', 60_000),
  },
  presence: {
    max: parsePositiveInt('SOCKET_RATE_LIMIT_PRESENCE_MAX', 120),
    windowMs: parsePositiveInt('SOCKET_RATE_LIMIT_PRESENCE_WINDOW_MS', 60_000),
  },
};

export const checkSocketEventRateLimit = (userId: string, eventType: EventType): boolean => {
  const rule = limits[eventType];
  const key = `${eventType}:${userId}`;
  const now = Date.now();
  const current = counters.get(key);

  if (!current || now > current.resetAt) {
    counters.set(key, { count: 1, resetAt: now + rule.windowMs });
    realtimeMetrics.increment('rate_limit.allowed');
    return true;
  }

  if (current.count >= rule.max) {
    realtimeMetrics.increment('rate_limit.blocked');
    return false;
  }
  current.count += 1;
  realtimeMetrics.increment('rate_limit.allowed');
  return true;
};

export const checkSocketEventRateLimitDistributed = async (
  userId: string,
  eventType: EventType
): Promise<boolean> => {
  const rule = limits[eventType];
  const key = `socket:rate_limit:${eventType}:${userId}`;
  try {
    const client = await getStateRedisClient();
    const count = await client.incr(key);
    if (count === 1) {
      await client.pExpire(key, rule.windowMs);
    }
    if (count > rule.max) {
      realtimeMetrics.increment('rate_limit.blocked');
      return false;
    }
    realtimeMetrics.increment('rate_limit.allowed');
    return true;
  } catch (error) {
    realtimeMetrics.increment('rate_limit.redis_error');
    if (STRICT_REDIS) {
      realtimeMetrics.increment('rate_limit.blocked');
      return false;
    }
    return checkSocketEventRateLimit(userId, eventType);
  }
};

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of counters.entries()) {
    if (now > value.resetAt) counters.delete(key);
  }
}, 60_000);

