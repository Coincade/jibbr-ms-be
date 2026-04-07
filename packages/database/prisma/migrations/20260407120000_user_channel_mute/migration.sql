-- Per-user channel notification mute (synced across clients / mobile)
CREATE TABLE "UserChannelMute" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserChannelMute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserChannelMute_userId_channelId_key" ON "UserChannelMute"("userId", "channelId");

CREATE INDEX "UserChannelMute_userId_idx" ON "UserChannelMute"("userId");

CREATE INDEX "UserChannelMute_channelId_idx" ON "UserChannelMute"("channelId");

ALTER TABLE "UserChannelMute" ADD CONSTRAINT "UserChannelMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserChannelMute" ADD CONSTRAINT "UserChannelMute_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
