-- Fix checksum for migration file restored to match git (no data loss).
-- Run once if Prisma reports: migration was modified after it was applied.
UPDATE "_prisma_migrations"
SET "checksum" = '62e24e448433ea716dc5f90a46a45b9c0aad63483c750a3cd4c95bbacd529f7c'
WHERE "migration_name" = '20260423100000_remove_suspended_collaboration_status';
