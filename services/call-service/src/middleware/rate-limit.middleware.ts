import type { Request, Response, NextFunction } from 'express';
import type { AuthRequest } from '@jibbr/auth-middleware';

const buckets = new Map<string, { count: number; resetAt: number }>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;

export const callRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  const userId = (req as AuthRequest).user?.id ?? req.ip ?? 'anon';
  const key = `${userId}:${req.path}`;
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }

  bucket.count += 1;
  if (bucket.count > MAX_REQUESTS) {
    res.status(429).json({ error: 'Too many call API requests. Try again shortly.' });
    return;
  }

  next();
};
