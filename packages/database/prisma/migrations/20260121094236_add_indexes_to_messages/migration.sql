-- CreateIndex
CREATE INDEX "Message_channelId_deletedAt_createdAt_idx" ON "Message"("channelId", "deletedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Message_conversationId_deletedAt_createdAt_idx" ON "Message"("conversationId", "deletedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Message_replyToId_idx" ON "Message"("replyToId");
