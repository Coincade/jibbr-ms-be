import express, { Application, Request, Response } from 'express';
import cors from 'cors';

import uploadRoutes from './routes/upload.route.js';
import { createJwtOrIpRateLimiter } from '@jibbr/rate-limit';

export const createUploadApp = (): Application => {
  const app: Application = express();

  app.set('trust proxy', 1);

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'upload-service',
      uptime: process.uptime(),
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      timestamp: new Date().toISOString(),
    });
  });

  app.use(createJwtOrIpRateLimiter());

  app.use('/api/upload', uploadRoutes);

  return app;
};
