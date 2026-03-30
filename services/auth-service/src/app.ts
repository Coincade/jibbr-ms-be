import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import { appLimiter } from './config/rateLimit.js';

type CreateAuthAppOptions = {
  isDbConnected?: () => boolean;
  viewsPath?: string;
};

export const createAuthApp = ({
  isDbConnected = () => true,
  viewsPath,
}: CreateAuthAppOptions = {}): Application => {
  const app: Application = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  if (viewsPath) {
    app.set('view engine', 'ejs');
    app.set('views', viewsPath);
  }

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'auth-service',
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
