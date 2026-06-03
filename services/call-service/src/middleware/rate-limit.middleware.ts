import type { Request, Response, NextFunction } from 'express';
import type { AuthRequest } from '@jibbr/auth-middleware';

const buckets = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;

const createRateLimit = (max: number) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const userId = (req as AuthRequest).user?.id ?? req.ip ?? 'anon';
    const key = `${userId}:${req.path}:${max}`;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', Math.max(0, max - bucket.count));
    res.setHeader('RateLimit-Reset', Math.ceil(bucket.resetAt / 1000));

    if (bucket.count > max) {
      res.status(429).json({ error: 'Too many requests. Try again shortly.' });
      return;
    }

    next();
  };

/** Join, transport, produce, consume — high burst on call setup. */
export const burstRateLimit = createRateLimit(200);

/** Standard call operations. */
export const standardRateLimit = createRateLimit(120);

/** High-frequency fire-and-forget (media-state, stats). */
export const relaxedRateLimit = createRateLimit(30);

/** Legacy export kept for any direct usages. */
export const callRateLimit = standardRateLimit;
