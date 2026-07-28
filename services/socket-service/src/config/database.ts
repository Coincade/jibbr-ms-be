import { PrismaClient } from '@jibbr/database';

const withPoolTuning = (url: string | undefined): string | undefined => {
  if (!url) return url;
  const hasConnectionLimit = /[?&]connection_limit=/.test(url);
  const hasPoolTimeout = /[?&]pool_timeout=/.test(url);
  const separator = url.includes('?') ? '&' : '?';
  let tuned = url;
  if (!hasConnectionLimit) tuned += `${tuned.includes('?') ? '&' : separator}connection_limit=5`;
  if (!hasPoolTimeout) tuned += `${tuned.includes('?') ? '&' : separator}pool_timeout=20`;
  return tuned;
};

const databaseUrl = withPoolTuning(process.env.DATABASE_URL);

// OPTIMIZATION: Configure Prisma for better performance
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
  errorFormat: 'pretty',
  // Only override the datasource when we have a URL — passing `undefined`
  // makes PrismaClient construction fail (e.g. under Turbo strict env).
  ...(databaseUrl
    ? {
        datasources: {
          db: {
            url: databaseUrl,
          },
        },
      }
    : {}),
});

// OPTIMIZATION: Enable connection pooling hints
// Prisma automatically uses connection pooling, but we can optimize query patterns

export default prisma;


