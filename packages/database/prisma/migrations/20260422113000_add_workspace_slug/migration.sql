ALTER TABLE "Workspace" ADD COLUMN "slug" TEXT;

UPDATE "Workspace"
SET "slug" = CONCAT(
  COALESCE(
    NULLIF(regexp_replace(lower(trim("name")), '[^a-z0-9]+', '-', 'g'), ''),
    'workspace'
  ),
  '-',
  substring("id" from 1 for 6)
)
WHERE "slug" IS NULL;

ALTER TABLE "Workspace" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
