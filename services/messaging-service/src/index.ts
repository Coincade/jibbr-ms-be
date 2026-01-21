import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import path from 'path';
import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import compression from 'compression';
import { createServer } from 'http';
import { Logger } from '@jibbr/logger';
import prisma from './config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = path.join(__dirname, '../.env');

dotenv.config({ path: envPath });

const app: Application = express();
const httpServer = createServer(app);
const logger = new Logger('messaging-service');

// DB connectivity guard (prevents noisy 500s when DATABASE_URL is misconfigured/unreachable)
let dbConnected = false;
let lastDbErrorLogAt = 0;

const tryConnectDb = async (): Promise<void> => {
  try {
    await prisma.$connect();
    dbConnected = true;
    logger.info('✅ Database connected');
  } catch (err) {
    dbConnected = false;
    const now = Date.now();
    if (now - lastDbErrorLogAt > 10_000) {
      lastDbErrorLogAt = now;
      logger.error('❌ Database connection failed (check DATABASE_URL / network)', err as Error);
    }
  }
};

void tryConnectDb();
setInterval(() => {
  if (!dbConnected) void tryConnectDb();
}, 10_000);

const PORT = process.env.PORT || process.env.MESSAGING_PORT || 3003;

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
}));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'messaging-service',
    dbConnected,
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    timestamp: new Date().toISOString(),
  });
});

// Routes
import messageRoutes from './routes/message.route.js';
import channelRoutes from './routes/channel.route.js';
import conversationRoutes from './routes/conversation.route.js';
import workspaceRoutes from './routes/workspace.route.js';
import userRoutes from './routes/user.route.js';
import notificationRoutes from './routes/notification.route.js';
import { appLimiter } from './config/rateLimit.js';

// Block API routes if DB isn't reachable (clear 503 instead of generic 500)
app.use((req: Request, res: Response, next) => {
  if (req.path === '/health') return next();
  if (!dbConnected) {
    return res.status(503).json({
      message: 'Database unavailable. Please try again in a moment.',
      status: 503,
    });
  }
  return next();
});

app.use('/api/messages', messageRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/users', userRoutes);
app.use('/api/notifications', notificationRoutes);

// Rate limiter
app.use(appLimiter);

httpServer.listen(PORT, () => {
  logger.info(`🚀 Messaging service is running on port ${PORT}`);
});

