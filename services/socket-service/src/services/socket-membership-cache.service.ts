import prisma from '../config/database.js';
import { getStateRedisClient } from '../config/redis.js';
import { retryWithBackoff } from '../libs/retry.js';
import { realtimeMetrics } from './realtime-observability.service.js';

const KEY_TTL_SECONDS = Number.parseInt(process.env.SOCKET_MEMBERSHIP_TTL_SECONDS || '900', 10);
const DB_FALLBACK_ENABLED = process.env.SOCKET_DB_FALLBACK_ENABLED === '1';
const FALLBACK_BREAKER_THRESHOLD = Number.parseInt(
  process.env.SOCKET_DB_FALLBACK_BREAKER_THRESHOLD || '20',
  10
);
const FALLBACK_BREAKER_COOLDOWN_MS = Number.parseInt(
  process.env.SOCKET_DB_FALLBACK_BREAKER_COOLDOWN_MS || '30000',
  10
);

type MembershipSnapshot = {
  channels: string[];
  conversations: string[];
  workspaces: string[];
};

const memoryChannelMembers = new Map<string, Set<string>>();
const memoryConversationMembers = new Map<string, Set<string>>();

const userChannelsKey = (userId: string) => `user:${userId}:channels`;
const userConversationsKey = (userId: string) => `user:${userId}:conversations`;
const userWorkspacesKey = (userId: string) => `user:${userId}:workspaces`;
const channelMembersKey = (channelId: string) => `channel:${channelId}:members`;
const conversationParticipantsKey = (conversationId: string) => `conversation:${conversationId}:participants`;

const logRedisFailure = (action: string, error: unknown) => {
  realtimeMetrics.increment('membership.redis.error');
  console.error(`[membership-cache] Redis failure during ${action}:`, error);
};

const fallbackCircuit = {
  failures: 0,
  openedUntil: 0,
};

const isFallbackBreakerOpen = (): boolean => Date.now() < fallbackCircuit.openedUntil;

const registerFallbackFailure = () => {
  fallbackCircuit.failures += 1;
  if (fallbackCircuit.failures >= FALLBACK_BREAKER_THRESHOLD) {
    fallbackCircuit.openedUntil = Date.now() + FALLBACK_BREAKER_COOLDOWN_MS;
    fallbackCircuit.failures = 0;
    console.error('[membership-cache] DB fallback circuit opened');
  }
};

const registerFallbackSuccess = () => {
  fallbackCircuit.failures = 0;
  fallbackCircuit.openedUntil = 0;
};

const getWorkspaceIdsForUser = async (userId: string): Promise<string[]> => {
  const memberships = await prisma.member.findMany({
    where: { userId, isActive: true },
    select: { workspaceId: true },
  });
  return memberships.map((row) => row.workspaceId);
};

export const loadMembershipsForUser = async (userId: string): Promise<MembershipSnapshot> => {
  const [channels, conversations, workspaces] = await Promise.all([
    prisma.channelMember.findMany({
      where: { userId, isActive: true },
      select: { channelId: true },
    }),
    prisma.conversationParticipant.findMany({
      where: { userId, isActive: true },
      select: { conversationId: true },
    }),
    getWorkspaceIdsForUser(userId),
  ]);

  return {
    channels: channels.map((entry) => entry.channelId),
    conversations: conversations.map((entry) => entry.conversationId),
    workspaces,
  };
};

const addToMemory = (store: Map<string, Set<string>>, key: string, userId: string) => {
  if (!store.has(key)) store.set(key, new Set<string>());
  store.get(key)!.add(userId);
};

const removeFromMemory = (store: Map<string, Set<string>>, key: string, userId: string) => {
  const set = store.get(key);
  if (!set) return;
  set.delete(userId);
  if (set.size === 0) store.delete(key);
};

const clearInMemoryMembershipCaches = () => {
  memoryChannelMembers.clear();
  memoryConversationMembers.clear();
};

export const warmMembershipCacheForUser = async (userId: string): Promise<MembershipSnapshot> => {
  const snapshot = await loadMembershipsForUser(userId);
  const client = await getStateRedisClient();

  await retryWithBackoff(async () => {
    const multi = client.multi();
    multi.del(userChannelsKey(userId), userConversationsKey(userId), userWorkspacesKey(userId));

    for (const channelId of snapshot.channels) {
      multi.sAdd(userChannelsKey(userId), channelId);
      multi.sAdd(channelMembersKey(channelId), userId);
      multi.expire(channelMembersKey(channelId), KEY_TTL_SECONDS);
      addToMemory(memoryChannelMembers, channelId, userId);
    }

    for (const conversationId of snapshot.conversations) {
      multi.sAdd(userConversationsKey(userId), conversationId);
      multi.sAdd(conversationParticipantsKey(conversationId), userId);
      multi.expire(conversationParticipantsKey(conversationId), KEY_TTL_SECONDS);
      addToMemory(memoryConversationMembers, conversationId, userId);
    }

    for (const workspaceId of snapshot.workspaces) {
      multi.sAdd(userWorkspacesKey(userId), workspaceId);
    }

    multi.expire(userChannelsKey(userId), KEY_TTL_SECONDS);
    multi.expire(userConversationsKey(userId), KEY_TTL_SECONDS);
    multi.expire(userWorkspacesKey(userId), KEY_TTL_SECONDS);
    await multi.exec();
  });

  return snapshot;
};

const safeRedisMembershipCheck = async (
  redisKey: string,
  member: string
): Promise<boolean | null> => {
  try {
    const client = await getStateRedisClient();
    const result = await retryWithBackoff<boolean>(() =>
      client.sIsMember(redisKey, member) as Promise<boolean>
    );
    if (result) realtimeMetrics.increment('membership.redis.hit');
    else realtimeMetrics.increment('membership.redis.miss');
    return result;
  } catch (error) {
    logRedisFailure(`membership check for ${redisKey}`, error);
    return null;
  }
};

const fallbackMembershipCheck = async (fallback: () => Promise<boolean>): Promise<boolean> => {
  if (!DB_FALLBACK_ENABLED) return false;
  if (isFallbackBreakerOpen()) {
    realtimeMetrics.increment('membership.fallback.blocked');
    return false;
  }
  try {
    realtimeMetrics.increment('membership.fallback.used');
    const result = await retryWithBackoff(fallback, { retries: 2 });
    registerFallbackSuccess();
    return result;
  } catch (error) {
    registerFallbackFailure();
    realtimeMetrics.increment('membership.fallback.error');
    console.error('[membership-cache] DB fallback failed:', error);
    return false;
  }
};

export const validateChannelMembershipCached = async (userId: string, channelId: string): Promise<boolean> => {
  const memorySet = memoryChannelMembers.get(channelId);
  if (memorySet?.has(userId)) return true;

  const redisResult = await safeRedisMembershipCheck(channelMembersKey(channelId), userId);
  if (redisResult !== null) {
    if (redisResult) addToMemory(memoryChannelMembers, channelId, userId);
    return redisResult;
  }

  return fallbackMembershipCheck(async () => {
    const member = await prisma.channelMember.findFirst({
      where: { channelId, userId, isActive: true },
      select: { id: true },
    });
    return !!member;
  });
};

export const validateConversationParticipationCached = async (
  userId: string,
  conversationId: string
): Promise<boolean> => {
  const memorySet = memoryConversationMembers.get(conversationId);
  if (memorySet?.has(userId)) return true;

  const redisResult = await safeRedisMembershipCheck(conversationParticipantsKey(conversationId), userId);
  if (redisResult !== null) {
    if (redisResult) addToMemory(memoryConversationMembers, conversationId, userId);
    return redisResult;
  }

  return fallbackMembershipCheck(async () => {
    const participant = await prisma.conversationParticipant.findFirst({
      where: { conversationId, userId, isActive: true },
      select: { id: true },
    });
    return !!participant;
  });
};

export const validateWorkspaceMembershipCached = async (userId: string, workspaceId: string): Promise<boolean> => {
  const redisResult = await safeRedisMembershipCheck(userWorkspacesKey(userId), workspaceId);
  if (redisResult === true) return true;

  // Redis false or unreadable: key missing / pre-warm / eviction — sIsMember on an empty/missing key
  // yields false; confirm with DB so legitimate members never get socket `join_workspace` errors.
  try {
    const member = await prisma.member.findFirst({
      where: { userId, workspaceId, isActive: true },
      select: { id: true },
    });
    return !!member;
  } catch (error) {
    console.error('[membership-cache] validateWorkspaceMembership DB check failed:', error);
    return false;
  }
};

export const applyChannelMembershipUpdate = async (
  userId: string,
  channelId: string,
  action: 'add' | 'remove'
): Promise<void> => {
  try {
    const client = await getStateRedisClient();
    await retryWithBackoff(async () => {
      const multi = client.multi();
      if (action === 'add') {
        multi.sAdd(userChannelsKey(userId), channelId);
        multi.sAdd(channelMembersKey(channelId), userId);
        multi.expire(userChannelsKey(userId), KEY_TTL_SECONDS);
        multi.expire(channelMembersKey(channelId), KEY_TTL_SECONDS);
        addToMemory(memoryChannelMembers, channelId, userId);
      } else {
        multi.sRem(userChannelsKey(userId), channelId);
        multi.sRem(channelMembersKey(channelId), userId);
        removeFromMemory(memoryChannelMembers, channelId, userId);
      }
      await multi.exec();
    });
  } catch (error) {
    logRedisFailure(`applyChannelMembershipUpdate:${action}`, error);
  }
};

export const applyConversationMembershipUpdate = async (
  userId: string,
  conversationId: string,
  action: 'add' | 'remove'
): Promise<void> => {
  try {
    const client = await getStateRedisClient();
    await retryWithBackoff(async () => {
      const multi = client.multi();
      if (action === 'add') {
        multi.sAdd(userConversationsKey(userId), conversationId);
        multi.sAdd(conversationParticipantsKey(conversationId), userId);
        multi.expire(userConversationsKey(userId), KEY_TTL_SECONDS);
        multi.expire(conversationParticipantsKey(conversationId), KEY_TTL_SECONDS);
        addToMemory(memoryConversationMembers, conversationId, userId);
      } else {
        multi.sRem(userConversationsKey(userId), conversationId);
        multi.sRem(conversationParticipantsKey(conversationId), userId);
        removeFromMemory(memoryConversationMembers, conversationId, userId);
      }
      await multi.exec();
    });
  } catch (error) {
    logRedisFailure(`applyConversationMembershipUpdate:${action}`, error);
  }
};

export const invalidateMembershipCacheForWorkspaces = async (workspaceIds: string[]): Promise<void> => {
  if (!workspaceIds.length) return;
  try {
    const members = await prisma.member.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        isActive: true,
      },
      select: { userId: true },
    });
    const userIds = [...new Set(members.map((m) => m.userId))];
    if (!userIds.length) return;

    const client = await getStateRedisClient();
    await retryWithBackoff(async () => {
      const multi = client.multi();
      for (const userId of userIds) {
        multi.del(userChannelsKey(userId), userConversationsKey(userId), userWorkspacesKey(userId));
      }
      await multi.exec();
    });
    // Invalidation events indicate policy/link changes. Clear local hot caches to avoid stale auth.
    clearInMemoryMembershipCaches();
  } catch (error) {
    logRedisFailure('invalidateMembershipCacheForWorkspaces', error);
  }
};

