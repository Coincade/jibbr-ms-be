-- PostgreSQL does not support dropping individual enum values directly.
-- The approach: drop any indexes whose WHERE predicate references the column,
-- rename the old type, create the replacement type, cast the column, then
-- recreate the indexes and drop the old type.

-- Step 1: drop the partial unique index whose predicate uses the status column
DROP INDEX IF EXISTS "WorkspaceCollaboration_active_pair_key";

-- Step 2: rename old enum out of the way
ALTER TYPE "WorkspaceCollaborationStatus" RENAME TO "WorkspaceCollaborationStatus_old";

-- Step 3: create the new enum without SUSPENDED
CREATE TYPE "WorkspaceCollaborationStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- Step 4: drop the column default so we can alter the type
ALTER TABLE "WorkspaceCollaboration"
  ALTER COLUMN "status" DROP DEFAULT;

-- Step 5: cast the column to the new type
--   Any row that was SUSPENDED is treated as REVOKED so no data is lost.
ALTER TABLE "WorkspaceCollaboration"
  ALTER COLUMN "status" TYPE "WorkspaceCollaborationStatus"
  USING CASE
    WHEN "status"::text = 'SUSPENDED' THEN 'REVOKED'::"WorkspaceCollaborationStatus"
    ELSE "status"::text::"WorkspaceCollaborationStatus"
  END;

-- Step 6: restore the column default
ALTER TABLE "WorkspaceCollaboration"
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- Step 7: drop the old enum
DROP TYPE "WorkspaceCollaborationStatus_old";

-- Step 8: recreate the partial unique index
CREATE UNIQUE INDEX "WorkspaceCollaboration_active_pair_key"
ON "WorkspaceCollaboration"("workspaceAId", "workspaceBId")
WHERE "status" = 'ACTIVE';
