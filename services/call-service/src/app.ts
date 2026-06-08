import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import callRoutes from './routes/call.route.js';
import { getCallServiceHealth } from './services/health.service.js';

export const createCallApp = (): Application => {
  const app: Application = express();

  app.use(
    cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
      credentials: true,
    })
  );
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    const health = getCallServiceHealth();
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(health);
  });

  app.use('/api', callRoutes);

  return app;
};
