// Export Prisma Client - types will be available after prisma generate
// Using a workaround for monorepo type resolution
export { PrismaClient } from '@prisma/client';

// Re-export Prisma namespace for type usage
export type { Prisma } from '@prisma/client';

// For model types, consumers should import directly from @prisma/client
// or use Prisma.UserGetPayload, Prisma.WorkspaceGetPayload, etc.
// This avoids type resolution issues in monorepo builds

