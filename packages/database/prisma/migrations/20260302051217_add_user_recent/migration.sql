-- CreateEnum
CREATE TYPE "RecentType" AS ENUM ('CHANNEL', 'CONVERSATION');

-- CreateTable
CREATE TABLE "UserRecent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "RecentType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "lastOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRecent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserRecent_userId_workspaceId_lastOpenedAt_idx" ON "UserRecent"("userId", "workspaceId", "lastOpenedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "UserRecent_userId_workspaceId_type_targetId_key" ON "UserRecent"("userId", "workspaceId", "type", "targetId");

-- AddForeignKey
ALTER TABLE "UserRecent" ADD CONSTRAINT "UserRecent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRecent" ADD CONSTRAINT "UserRecent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
