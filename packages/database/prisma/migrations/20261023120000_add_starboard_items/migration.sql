-- CreateEnum
CREATE TYPE "StarboardItemType" AS ENUM ('CHANNEL', 'MEMBER');

-- CreateTable
CREATE TABLE "StarboardItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "itemType" "StarboardItemType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StarboardItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StarboardItem_userId_workspaceId_idx" ON "StarboardItem"("userId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "StarboardItem_userId_workspaceId_itemType_itemId_key" ON "StarboardItem"("userId", "workspaceId", "itemType", "itemId");

-- AddForeignKey
ALTER TABLE "StarboardItem" ADD CONSTRAINT "StarboardItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StarboardItem" ADD CONSTRAINT "StarboardItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
