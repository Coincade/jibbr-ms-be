import express, { Application, Request, Response, type Router } from 'express';
import cors from 'cors';
import { createDesktopVersionMiddleware, handleDesktopVersionStatus } from '@jibbr/shared-utils';
import { realtimeMetrics } from './services/realtime-observability.service.js';

export type CreateSocketAppOptions = {
  /** Mounted at `/internal`. Omit in light health/e2e tests to avoid loading websocket/Prisma. */
  internalRouter?: Router;
};

export const createSocketApp = (
  options: CreateSocketAppOptions = {}
): Application => {
  const app: Application = express();

  app.use(
    cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'socket-service',
      uptime: process.uptime(),
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/client/version-status', handleDesktopVersionStatus);
  app.use(createDesktopVersionMiddleware());

  if (options.internalRouter) {
    app.use('/internal', options.internalRouter);
  }

  app.get('/health/realtime', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'socket-service',
      realtimeMetrics: realtimeMetrics.snapshot(),
      timestamp: new Date().toISOString(),
    });
  });

  return app;
};
