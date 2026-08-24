import type { DesktopClientMeta } from './desktop-version';
import { getDesktopVersionPolicy, sanitizeClientMeta } from './desktop-version';

const MEMORY_TTL_MS = 24 * 60 * 60 * 1000;
const REDIS_TTL_SECONDS = 24 * 60 * 60;

export type DesktopVersionSeen = {
  userId: string;
  client: string;
  version: string;
  platform: string | null;
  arch: string | null;
  timestamp: string;
};

export type DesktopVersionStats = {
  latestVersion: string;
  minimumSupportedVersion: string;
  versions: Array<{ version: string; activeUsers: number }>;
};

type RedisLike = {
  set: (key: string, value: string, options?: { EX?: number }) => Promise<unknown>;
  sAdd: (key: string, member: string) => Promise<unknown>;
  expire: (key: string, seconds: number) => Promise<unknown>;
  sMembers: (key: string) => Promise<string[]>;
  get: (key: string) => Promise<string | null>;
};

const memory = new Map<string, { record: DesktopVersionSeen; expiresAt: number }>();
let redisClient: RedisLike | null = null;

const userKey = (userId: string) => `jibbr:desktop:user:${userId}`;
const INDEX_KEY = 'jibbr:desktop:index';

export function setDesktopVersionTelemetryRedis(client: RedisLike | null): void {
  redisClient = client;
}

export function resetDesktopVersionTelemetryForTests(): void {
  memory.clear();
}

function pruneMemory(now = Date.now()): void {
  for (const [id, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(id);
  }
}

export async function recordDesktopClientSeen(
  userId: string,
  meta: DesktopClientMeta | null | undefined
): Promise<void> {
  if (!userId || !meta?.version) return;
  const version = sanitizeClientMeta(meta.version);
  if (!version) return;
  const record: DesktopVersionSeen = {
    userId,
    client: meta.client || 'unknown',
    version,
    platform: meta.platform,
    arch: meta.arch,
    timestamp: new Date().toISOString(),
  };

  memory.set(userId, { record, expiresAt: Date.now() + MEMORY_TTL_MS });

  if (!redisClient) return;
  try {
    const payload = JSON.stringify(record);
    await redisClient.set(userKey(userId), payload, { EX: REDIS_TTL_SECONDS });
    await redisClient.sAdd(INDEX_KEY, userId);
    await redisClient.expire(INDEX_KEY, REDIS_TTL_SECONDS);
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: 'desktop-version',
        level: 'warn',
        message: 'Failed to persist desktop version telemetry',
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

export async function getDesktopVersionStats(): Promise<DesktopVersionStats> {
  pruneMemory();
  const policy = getDesktopVersionPolicy();
  const byVersion = new Map<string, Set<string>>();

  const add = (userId: string, version: string) => {
    const set = byVersion.get(version) ?? new Set<string>();
    set.add(userId);
    byVersion.set(version, set);
  };

  if (redisClient) {
    try {
      const ids = await redisClient.sMembers(INDEX_KEY);
      for (const id of ids) {
        const raw = await redisClient.get(userKey(id));
        if (!raw) continue;
        const parsed = JSON.parse(raw) as DesktopVersionSeen;
        if (parsed?.userId && parsed.version) add(parsed.userId, parsed.version);
      }
    } catch (error) {
      console.warn(
        JSON.stringify({
          service: 'desktop-version',
          level: 'warn',
          message: 'Failed to read desktop version telemetry',
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }

  for (const [userId, entry] of memory) {
    add(userId, entry.record.version);
  }

  const versions = [...byVersion.entries()]
    .map(([version, users]) => ({ version, activeUsers: users.size }))
    .sort((a, b) => b.activeUsers - a.activeUsers);

  return {
    latestVersion: policy.latestVersion,
    minimumSupportedVersion: policy.minimumSupportedVersion,
    versions,
  };
}
