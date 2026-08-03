import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { Logger } from '@jibbr/logger';
import { createSocketApp } from './app.js';
import internalCallRoutes from './routes/internal-call.route.js';
import presenceRoutes from './routes/presence.route.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = path.join(__dirname, '../.env');

console.log('📁 Loading .env from:', envPath);
const result = dotenv.config({ path: envPath, override: true });
if (result.error) {
  console.error('❌ Failed to load .env:', result.error);
} else {
  console.log('✅ .env loaded successfully');
}

const app = createSocketApp({ internalRouter: internalCallRoutes });
const httpServer = createServer(app);
const logger = new Logger('socket-service');

app.use('/api/presence', presenceRoutes);

const PORT = process.env.PORT || process.env.SOCKET_PORT || 3004;

// Initialize WebSocket service
(async () => {
  try {
    const [{ setTokenVersionLookup }, { getUserTokenVersion }] = await Promise.all([
      import('@jibbr/auth-middleware'),
      import('./websocket/utils.js'),
    ]);
    setTokenVersionLookup(async (userId: string) => getUserTokenVersion(userId));

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


