import express, { Application, Request, Response, Router } from 'express';
import cors from 'cors';
import callRoutes from './routes/call.route.js';
import { hostCheckInternal, kickPeerInternal } from './routes/internal-call.route.js';
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

  const internal = Router();
  internal.post('/call/kick-peer', (req, res) => {
    void kickPeerInternal(req, res);
  });
  internal.post('/call/host-check', (req, res) => {
    void hostCheckInternal(req, res);
  });
  app.use('/internal', internal);

  app.use('/api', callRoutes);

  return app;
};
