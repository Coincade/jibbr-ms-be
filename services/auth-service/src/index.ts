import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import path from 'path';
import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import ejs from 'ejs';
import { Logger } from '@jibbr/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = path.join(__dirname, '../.env');

dotenv.config({ path: envPath });

const app: Application = express();
const logger = new Logger('auth-service');

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
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    timestamp: new Date().toISOString(),
  });
});

// Routes
import authRoutes from './routes/auth.route.js';
import verifyRoutes from './routes/verify.route.js';
import { authLimiter, appLimiter } from './config/rateLimit.js';

app.use('/api/auth', authRoutes);
app.use('/api/verify', verifyRoutes);

// Rate limiter
app.use(appLimiter);

// Initialize email queue
import './jobs/index.js';

app.listen(PORT, () => {
  logger.info(`🚀 Auth service is running on port ${PORT}`);
});

