import rateLimit from 'express-rate-limit';
import type { Request, RequestHandler, Response } from 'express';
import type { Options } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import type { JWTPayload } from '@jibbr/shared-types';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 100;

function parseEnvInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type CreateJwtOrIpRateLimiterOptions = {
  /** Env var name for JWT secret (read on each request, after dotenv). Default JWT_SECRET */
  jwtSecretEnvVar?: string;
  windowMs?: number;
  limit?: number;
  message?: string;
  skip?: Options['skip'];
};

/**
 * express-rate-limit middleware: counts requests per verified JWT user id when
 * Authorization Bearer token is valid; otherwise per req.ip. Reads JWT secret
 * from env on each request so dotenv in the service entrypoint has run.
 */
export function createJwtOrIpRateLimiter(
  options: CreateJwtOrIpRateLimiterOptions = {}
): RequestHandler {
  const jwtSecretEnvVar = options.jwtSecretEnvVar ?? 'JWT_SECRET';
  const message =
    options.message ?? 'Too many requests, please try again later.';

  return rateLimit({
    windowMs:
      options.windowMs ?? parseEnvInt('RATE_LIMIT_WINDOW_MS', DEFAULT_WINDOW_MS),
    limit: options.limit ?? parseEnvInt('RATE_LIMIT_MAX', DEFAULT_LIMIT),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message,
    skip: (req, res) => {
      if (req.path === '/health') return true;
      return options.skip?.(req, res) ?? false;
    },
    keyGenerator: (req: Request, _res: Response) => {
      const secret = process.env[jwtSecretEnvVar] ?? '';
      const header = req.headers.authorization ?? '';
      const raw = header.startsWith('Bearer ') ? header.slice(7) : header;
      const token = raw.trim();
      if (secret && token) {
        try {
          const decoded = jwt.verify(token, secret) as JWTPayload;
          if (decoded?.id) return `user:${decoded.id}`;
        } catch {
          // invalid / expired token — still limit by IP
        }
      }
      return `ip:${req.ip ?? 'unknown'}`;
    },
  });
}
