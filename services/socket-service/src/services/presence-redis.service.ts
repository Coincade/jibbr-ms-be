import { getStateRedisClient } from '../config/redis.js';

const ONLINE_SET_KEY = 'presence:online';
const connKey = (userId: string) => `presence:conn:${userId}`;
const PRESENCE_TTL_SECONDS = Number.parseInt(process.env.PRESENCE_TTL_SECONDS || '90', 10);

const safeRedis = async <T>(fn: (client: any) => Promise<T>, fallback: T): Promise<T> => {
  try {
    const client = await getStateRedisClient();
    return await fn(client);
  } catch (error) {
    console.error('[presence] Redis error:', error);
    return fallback;
  }
};

/** Increment cross-instance connection count and mark user online. */
export const redisPresenceOnline = async (userId: string): Promise<void> => {
  await safeRedis(async (client) => {
    const count = await client.incr(connKey(userId));
    await client.expire(connKey(userId), PRESENCE_TTL_SECONDS);
    await client.sAdd(ONLINE_SET_KEY, userId);
    return count;
  }, 0);
};

/** Refresh heartbeat TTL so multi-instance readers still see the user. */
export const redisPresenceHeartbeat = async (userId: string): Promise<void> => {
  await safeRedis(async (client) => {
    const exists = await client.exists(connKey(userId));
    if (exists) {
      await client.expire(connKey(userId), PRESENCE_TTL_SECONDS);
    }
    return true;
  }, false);
};

/**
 * Decrement connection count. When it hits zero, remove from the online set.
 * Returns whether the user is still considered online on any instance.
 */
export const redisPresenceOffline = async (userId: string): Promise<boolean> => {
  return safeRedis(async (client) => {
    const remaining = await client.decr(connKey(userId));
    if (remaining <= 0) {
      await client.del(connKey(userId));
      await client.sRem(ONLINE_SET_KEY, userId);
      return false;
    }
    await client.expire(connKey(userId), PRESENCE_TTL_SECONDS);
    return true;
  }, false);
};

export const redisGetOnlineUsers = async (): Promise<string[]> => {
  return safeRedis(async (client) => {
    const members: string[] = await client.sMembers(ONLINE_SET_KEY);
    if (!members.length) return [];
    const online: string[] = [];
    const stale: string[] = [];
    for (const id of members) {
      const alive = await client.exists(connKey(id));
      if (alive) online.push(id);
      else stale.push(id);
    }
    if (stale.length) {
      await client.sRem(ONLINE_SET_KEY, stale);
    }
    return online;
  }, []);
};

export const redisIsUserOnline = async (userId: string): Promise<boolean> => {
  return safeRedis(async (client) => {
    const alive = await client.exists(connKey(userId));
    return alive === 1;
  }, false);
};

export const redisGetUsersOnlineStatus = async (
  userIds: string[]
): Promise<Record<string, boolean>> => {
  const status: Record<string, boolean> = {};
  await Promise.all(
    userIds.map(async (id) => {
      status[id] = await redisIsUserOnline(id);
    })
  );
  return status;
};
