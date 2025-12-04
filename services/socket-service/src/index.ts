import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import path from 'path';
import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Logger } from '@jibbr/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = path.join(__dirname, '../.env');

console.log('📁 Loading .env from:', envPath);
const result = dotenv.config({ path: envPath });
if (result.error) {
  console.error('❌ Failed to load .env:', result.error);
} else {
  console.log('✅ .env loaded successfully');
  console.log('🔍 Redis env check:', {
    REDIS_URL: process.env.REDIS_URL ? 'SET' : 'NOT SET',
    REDIS_HOST: process.env.REDIS_HOST || 'NOT SET',
    REDIS_PORT: process.env.REDIS_PORT || 'NOT SET',
    REDIS_PASSWORD: process.env.REDIS_PASSWORD ? 'SET' : 'NOT SET',
  });
}

const app: Application = express();
const httpServer = createServer(app);
const logger = new Logger('socket-service');

const PORT = process.env.PORT || process.env.SOCKET_PORT || 3004;

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'socket-service',
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    timestamp: new Date().toISOString(),
  });
});

// Presence routes (copied from messaging-service, but now local)
import presenceRoutes from './routes/presence.route.js';
app.use('/api/presence', presenceRoutes);

// Initialize WebSocket service
(async () => {
  try {
    const { initializeWebSocketService } = await import('./websocket/index.js');
    await initializeWebSocketService(httpServer);

    httpServer.listen(PORT, () => {
      logger.info(`🚀 Socket service is running on port ${PORT}`);
      logger.info(`🔌 WebSocket server running on ws://localhost:${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to initialize socket service', error as Error);
    process.exit(1);
  }
})();


