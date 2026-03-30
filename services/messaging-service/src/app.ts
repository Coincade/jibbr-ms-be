import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import compression from 'compression';
import { appLimiter } from './config/rateLimit.js';

type CreateMessagingAppOptions = {
  isDbConnected?: () => boolean;
};

export const createMessagingApp = ({
  isDbConnected = () => true,
}: CreateMessagingAppOptions = {}): Application => {
  const app: Application = express();

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

  app.use(appLimiter);

  return app;
};
