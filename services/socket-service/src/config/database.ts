import { PrismaClient } from '@jibbr/database';

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
  errorFormat: 'pretty',
});

export default prisma;


