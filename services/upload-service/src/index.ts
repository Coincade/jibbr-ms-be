import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import path from 'path';
import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import { Logger } from '@jibbr/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = path.join(__dirname, '../.env');

dotenv.config({ path: envPath });

const app: Application = express();
const logger = new Logger('upload-service');

// Use a dedicated env var for upload service
const rawPort = process.env.PORT || process.env.UPLOAD_PORT;
const PORT = rawPort && !Number.isNaN(Number(rawPort)) ? Number(rawPort) : 3002;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'upload-service',
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    timestamp: new Date().toISOString(),
  });
});

// Routes
import uploadRoutes from './routes/upload.route.js';

app.use('/api/upload', uploadRoutes);

app.listen(PORT, () => {
  logger.info(`🚀 Upload service is running on port ${PORT}`);
});

