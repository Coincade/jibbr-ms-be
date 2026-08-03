import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import path from 'path';
import { Logger } from '@jibbr/logger';
import { createCallApp } from './app.js';
import { initMediasoupWorkers, closeMediasoupWorkers } from './mediasoup/workers.js';
import { logIceServerStatus } from './config/mediasoup.js';
import { initRedis, closeRedis } from './config/redis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = path.join(__dirname, '../.env');

dotenv.config({ path: envPath, override: true });

const logger = new Logger('call-service');
const PORT = process.env.PORT || process.env.CALL_PORT || 3005;

const start = async () => {
  try {
    initRedis();
    await initMediasoupWorkers();
    logIceServerStatus();

    const [{ setTokenVersionLookup }, { default: prisma }] = await Promise.all([
      import('@jibbr/auth-middleware'),
      import('./config/database.js'),
    ]);
    setTokenVersionLookup(async (userId: string) => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { tokenVersion: true },
      });
      return user ? (user.tokenVersion ?? 0) : null;
    });

    const app = createCallApp();

    const server = app.listen(PORT, () => {
      logger.info(`Call service running on port ${PORT}`);
    });

    const shutdown = async () => {
      logger.info('Shutting down call service...');
      server.close();
      await closeMediasoupWorkers();
      await closeRedis();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error('Failed to start call service', error as Error);
    process.exit(1);
  }
};

start();
