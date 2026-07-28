-- CreateTable
CREATE TABLE "HuddleSession" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "channelId" TEXT,
    "conversationId" TEXT,
    "workspaceId" TEXT,
    "startedById" TEXT NOT NULL,
    "mediasoupSessionId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "peakParticipantCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HuddleSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HuddleSession_roomId_idx" ON "HuddleSession"("roomId");

-- CreateIndex
CREATE INDEX "HuddleSession_workspaceId_startedAt_idx" ON "HuddleSession"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "HuddleSession_channelId_idx" ON "HuddleSession"("channelId");

-- CreateIndex
CREATE INDEX "HuddleSession_conversationId_idx" ON "HuddleSession"("conversationId");

-- AddForeignKey
ALTER TABLE "HuddleSession" ADD CONSTRAINT "HuddleSession_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HuddleSession" ADD CONSTRAINT "HuddleSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HuddleSession" ADD CONSTRAINT "HuddleSession_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
