-- DropForeignKey
ALTER TABLE "ForwardedMessage" DROP CONSTRAINT "ForwardedMessage_channelId_fkey";

-- AlterTable
ALTER TABLE "ForwardedMessage" ADD COLUMN     "conversationId" TEXT,
ALTER COLUMN "channelId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ForwardedMessage" ADD CONSTRAINT "ForwardedMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForwardedMessage" ADD CONSTRAINT "ForwardedMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
