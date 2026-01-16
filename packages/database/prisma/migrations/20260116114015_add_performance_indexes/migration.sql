-- CreateIndex
CREATE INDEX "ChannelMember_userId_channelId_isActive_idx" ON "ChannelMember"("userId", "channelId", "isActive");

-- CreateIndex
CREATE INDEX "ChannelMember_channelId_isActive_idx" ON "ChannelMember"("channelId", "isActive");

-- CreateIndex
CREATE INDEX "ConversationParticipant_userId_isActive_idx" ON "ConversationParticipant"("userId", "isActive");

-- CreateIndex
CREATE INDEX "ConversationParticipant_conversationId_isActive_idx" ON "ConversationParticipant"("conversationId", "isActive");

-- CreateIndex
CREATE INDEX "Message_channelId_createdAt_idx" ON "Message"("channelId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Message_userId_createdAt_idx" ON "Message"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Message_deletedAt_idx" ON "Message"("deletedAt");
