import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { Logger } from '@jibbr/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = path.join(__dirname, '../.env');

dotenv.config({ path: envPath, override: true });

const logger = new Logger('messaging-service');

void (async () => {
  // IMPORTANT: load env first, then import modules that create Redis clients.
  const [
    { default: prisma },
    { createMessagingApp },
    { default: messageRoutes },
    { default: channelRoutes },
    { default: conversationRoutes },
    { default: workspaceRoutes },
    { default: userRoutes },
    { default: notificationRoutes },
    { default: recentsRoutes },
    { default: searchRoutes },
    { default: workspaceCollaborationRoutes },
    { default: collaborationGroupRoutes },
    {
      getMembershipOutboxStats,
      initMembershipOutbox,
      startMembershipOutboxCleanup,
      startMembershipOutboxRelay,
    },
  ] = await Promise.all([
    import('./config/database.js'),
    import('./app.js'),
    import('./routes/message.route.js'),
    import('./routes/channel.route.js'),
    import('./routes/conversation.route.js'),
    import('./routes/workspace.route.js'),
    import('./routes/user.route.js'),
    import('./routes/notification.route.js'),
    import('./routes/recents.route.js'),
    import('./routes/search.route.js'),
    import('./routes/workspace-collaboration.route.js'),
    import('./routes/collaboration-group.route.js'),
    import('./services/membership-outbox.service.js'),
  ]);

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
  app.use('/api/workspace-collaborations', workspaceCollaborationRoutes);
  app.use('/api/collaboration-groups', collaborationGroupRoutes);
  app.get('/health/outbox', async (_req, res) => {
    try {
      const stats = await getMembershipOutboxStats();
      res.json({
        status: 'healthy',
        service: 'messaging-service',
        outbox: stats,
        timestamp: new Date().toISOString(),
      });
    } catch (_error) {
      res.status(500).json({ status: 'error', message: 'Failed to read outbox stats' });
    }
  });

  const httpServer = createServer(app);

  void tryConnectDb();
  setInterval(() => {
    if (!dbConnected) void tryConnectDb();
  }, 10_000);

  void initMembershipOutbox()
    .then(() => {
      startMembershipOutboxRelay();
      startMembershipOutboxCleanup();
      logger.info('✅ Membership outbox relay started');
    })
    .catch((error) => {
      logger.error('❌ Failed to initialize membership outbox', error as Error);
    });

  const PORT = process.env.PORT || process.env.MESSAGING_PORT || 3003;
  httpServer.listen(PORT, () => {
    logger.info(`🚀 Messaging service is running on port ${PORT}`);
  });
})().catch((error) => {
  logger.error('❌ Failed to start messaging service', error as Error);
  process.exit(1);
});

