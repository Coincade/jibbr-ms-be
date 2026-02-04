import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import path from 'path';
import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import ejs from 'ejs';
import { Logger } from '@jibbr/logger';
import prisma from './config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = path.join(__dirname, '../.env');

dotenv.config({ path: envPath });

const app: Application = express();
const logger = new Logger('auth-service');

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
    // Throttle logs to avoid spamming on repeated failures
    if (now - lastDbErrorLogAt > 10_000) {
      lastDbErrorLogAt = now;
      logger.error('❌ Database connection failed (check DATABASE_URL / network)', err as Error);
    }
  }
};

// Kick off initial connection attempt + retry in background until connected
void tryConnectDb();
setInterval(() => {
  if (!dbConnected) void tryConnectDb();
}, 10_000);

// Use a dedicated env var for auth service to avoid clashing with main backend PORT
const rawPort = process.env.PORT || process.env.AUTH_PORT;
const PORT = rawPort && !Number.isNaN(Number(rawPort)) ? Number(rawPort) : 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Set view engine for email templates
app.set('view engine', 'ejs');
app.set('views', path.resolve(__dirname, './views'));

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'auth-service',
    dbConnected,
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    timestamp: new Date().toISOString(),
  });
});

// Routes
import authRoutes from './routes/auth.route.js';
import verifyRoutes from './routes/verify.route.js';
import internalRoutes from './routes/internal.route.js';
import { authLimiter, appLimiter } from './config/rateLimit.js';

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

app.use('/api/auth', authRoutes);
app.use('/api/verify', verifyRoutes);
app.use('/api/internal', internalRoutes);

// Rate limiter
app.use(appLimiter);

// Initialize email queue
import './jobs/index.js';

// Listen on all interfaces (0.0.0.0) to allow connections from emulators and devices
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Auth service is running on port ${PORT}`);
  logger.info(`📡 Listening on all interfaces (0.0.0.0:${PORT})`);
  logger.info(`🌐 Accessible at: http://localhost:${PORT} or http://10.0.2.2:${PORT} (Android emulator)`);
});

