import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import callRoutes from './routes/call.route.js';
import { getActiveRoomIds } from './mediasoup/rooms.js';

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
    res.json({
      status: 'healthy',
      service: 'call-service',
      uptime: process.uptime(),
      activeRooms: getActiveRoomIds().length,
      mediasoupWorkers: Number.parseInt(process.env.MEDIASOUP_NUM_WORKERS || '1', 10),
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api', callRoutes);

  return app;
};
