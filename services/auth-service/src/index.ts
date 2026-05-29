import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import path from 'path';
import { Logger } from '@jibbr/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = path.join(__dirname, '../.env');

dotenv.config({ path: envPath, override: true });

const logger = new Logger('auth-service');

void (async () => {
  // IMPORTANT: load env first, then import modules that create Redis/BullMQ clients.
  const [{ default: prisma }, { createAuthApp }, { default: authRoutes }, { default: verifyRoutes }, { default: internalRoutes }] =
    await Promise.all([
      import('./config/database.js'),
      import('./app.js'),
      import('./routes/auth.route.js'),
      import('./routes/verify.route.js'),
      import('./routes/internal.route.js'),
    ]);

  // Initialize email queue after dotenv has already populated process.env.
  await import('./jobs/index.js');

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

  const rawPort = process.env.PORT || process.env.AUTH_PORT;
  const PORT = rawPort && !Number.isNaN(Number(rawPort)) ? Number(rawPort) : 3001;

  const app = createAuthApp({
    isDbConnected: () => dbConnected,
    viewsPath: path.resolve(__dirname, './views'),
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/verify', verifyRoutes);
  app.use('/api/internal', internalRoutes);

  // Listen on all interfaces (0.0.0.0) to allow connections from emulators and devices
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 Auth service is running on port ${PORT}`);
    logger.info(`📡 Listening on all interfaces (0.0.0.0:${PORT})`);
    logger.info(
      `🌐 Accessible at: http://localhost:${PORT} or http://10.0.2.2:${PORT} (Android emulator)`
    );
  });
})().catch((error) => {
  logger.error('❌ Failed to start auth service', error as Error);
  process.exit(1);
});

