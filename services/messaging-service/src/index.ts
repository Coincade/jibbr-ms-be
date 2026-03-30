import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { Logger } from '@jibbr/logger';
import prisma from './config/database.js';
import { createMessagingApp } from './app.js';
import messageRoutes from './routes/message.route.js';
import channelRoutes from './routes/channel.route.js';
import conversationRoutes from './routes/conversation.route.js';
import workspaceRoutes from './routes/workspace.route.js';
import userRoutes from './routes/user.route.js';
import notificationRoutes from './routes/notification.route.js';
import recentsRoutes from './routes/recents.route.js';
import searchRoutes from './routes/search.route.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = path.join(__dirname, '../.env');

dotenv.config({ path: envPath });

const app = createMessagingApp({
  isDbConnected: () => dbConnected,
});

app.use('/api/messages', messageRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/users', userRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/recents', recentsRoutes);
app.use('/api/search', searchRoutes);
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

httpServer.listen(PORT, () => {
  logger.info(`🚀 Messaging service is running on port ${PORT}`);
});

