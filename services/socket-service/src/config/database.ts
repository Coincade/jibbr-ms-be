import { PrismaClient } from '@jibbr/database';

// OPTIMIZATION: Configure Prisma for better performance
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
  errorFormat: 'pretty',
  // Connection pool optimization for faster queries
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// OPTIMIZATION: Enable connection pooling hints
// Prisma automatically uses connection pooling, but we can optimize query patterns

export default prisma;


