/*
  Warnings:

  - A unique constraint covering the columns `[userId,clientMessageId]` on the table `Message` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "clientMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_userId_clientMessageId_key" ON "Message"("userId", "clientMessageId");
