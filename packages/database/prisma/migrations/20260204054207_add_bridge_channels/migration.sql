-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "isBridgeChannel" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ChannelMember" ADD COLUMN     "isExternal" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ChannelInvite" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "inviteeEmail" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelInvite_token_key" ON "ChannelInvite"("token");

-- CreateIndex
CREATE INDEX "ChannelInvite_token_idx" ON "ChannelInvite"("token");

-- CreateIndex
CREATE INDEX "ChannelInvite_channelId_idx" ON "ChannelInvite"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelInvite_channelId_inviteeEmail_key" ON "ChannelInvite"("channelId", "inviteeEmail");

-- AddForeignKey
ALTER TABLE "ChannelInvite" ADD CONSTRAINT "ChannelInvite_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelInvite" ADD CONSTRAINT "ChannelInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
