import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import compression from 'compression';
import { appLimiter, isReadHeavyRequest, readHeavyLimiter } from './config/rateLimit.js';

type CreateMessagingAppOptions = {
  isDbConnected?: () => boolean;
};

export const createMessagingApp = ({
  isDbConnected = () => true,
}: CreateMessagingAppOptions = {}): Application => {
  const app: Application = express();

  // DigitalOcean/App Platform (and most reverse proxies) set X-Forwarded-For.
  // express-rate-limit expects `trust proxy` enabled in that setup, otherwise it throws
  // ERR_ERL_UNEXPECTED_X_FORWARDED_FOR and/or mis-identifies clients.
  // `1` trusts exactly one proxy hop (safe default for typical deployments).
  app.set('trust proxy', 1);

  app.use(
    cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
      credentials: true,
    })
  );
  app.use(compression());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'messaging-service',
      dbConnected: isDbConnected(),
      uptime: process.uptime(),
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      timestamp: new Date().toISOString(),
    });
  });

  app.use((req: Request, res: Response, next) => {
    if (req.path === '/health') return next();
    if (!isDbConnected()) {
      return res.status(503).json({
        message: 'Database unavailable. Please try again in a moment.',
        status: 503,
      });
    }
    return next();
  });

  app.use((req: Request, res: Response, next) => {
    const limiter = isReadHeavyRequest(req) ? readHeavyLimiter : appLimiter;
    return limiter(req, res, next);
  });

  return app;
};
