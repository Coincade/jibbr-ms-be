/*
  Warnings:

  - Added the required column `channelAdminId` to the `Channel` table without a default value. This is not possible if the table is not empty.

*/
-- Step 1: Add the column as nullable first
ALTER TABLE "Channel" ADD COLUMN "channelAdminId" TEXT;

-- Step 2: Set channelAdminId to workspace owner for existing channels
UPDATE "Channel" 
SET "channelAdminId" = w."userId" 
FROM "Workspace" w 
WHERE "Channel"."workspaceId" = w."id";

-- Step 3: Make the column NOT NULL
ALTER TABLE "Channel" ALTER COLUMN "channelAdminId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_channelAdminId_fkey" FOREIGN KEY ("channelAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
