import { createJwtOrIpRateLimiter } from '@jibbr/rate-limit';
import type { Request } from 'express';

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const readHeavyWindowMs = parsePositiveInt(
  process.env.RATE_LIMIT_READ_WINDOW_MS,
  parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 60_000)
);

const readHeavyLimit = parsePositiveInt(process.env.RATE_LIMIT_READ_MAX, 400);

const readHeavyRoutes = [
  /^\/api\/notifications\/unread-counts$/,
  /^\/api\/notifications\/notifications$/,
  /^\/api\/notifications\/preferences$/,
  /^\/api\/notifications\/channel-mutes$/,
  /^\/api\/conversations(?:\/.*)?$/,
  /^\/api\/channels\/workspace\/[^/]+$/,
  /^\/api\/channels\/[^/]+$/,
  /^\/api\/workspaces\/get-workspaces-for-user$/,
  /^\/api\/workspaces\/get-workspace-members\/[^/]+$/,
  /^\/api\/workspaces\/get-public-channels\/[^/]+$/,
  /^\/api\/workspaces\/[^/]+$/,
  /^\/api\/users\/[^/]+\/profile$/,
  /^\/api\/users\/[^/]+\/status$/,
];

export const isReadHeavyRequest = (req: Request): boolean =>
  req.method === 'GET' && readHeavyRoutes.some((route) => route.test(req.path));

export const appLimiter = createJwtOrIpRateLimiter();

export const readHeavyLimiter = createJwtOrIpRateLimiter({
  windowMs: readHeavyWindowMs,
  limit: readHeavyLimit,
});

const collabSearchWindowMs = parsePositiveInt(
  process.env.COLLAB_SEARCH_RATE_LIMIT_WINDOW_MS,
  60_000
);
const collabSearchLimit = parsePositiveInt(process.env.COLLAB_SEARCH_RATE_LIMIT_MAX, 40);

/** Stricter limit for federated collaborator search (enumeration / load). */
export const collaboratorSearchLimiter = createJwtOrIpRateLimiter({
  windowMs: collabSearchWindowMs,
  limit: collabSearchLimit,
  message: "Too many collaborator searches. Please wait a moment and try again.",
});
