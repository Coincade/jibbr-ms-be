-- Collaboration Groups: N-way workspace collaboration (e.g. Hirect + sister companies)
-- Purely additive migration — no existing data is touched.

CREATE TYPE "CollaborationGroupStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "CollaborationGroupRole" AS ENUM ('OWNER', 'MEMBER');
CREATE TYPE "CollaborationGroupMemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'REVOKED');

CREATE TABLE "CollaborationGroup" (
  "id"              TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "status"          "CollaborationGroupStatus" NOT NULL DEFAULT 'ACTIVE',
  "policyId"        TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollaborationGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollaborationGroupMembership" (
  "id"              TEXT NOT NULL,
  "groupId"         TEXT NOT NULL,
  "workspaceId"     TEXT NOT NULL,
  "role"            "CollaborationGroupRole"        NOT NULL DEFAULT 'MEMBER',
  "status"          "CollaborationGroupMemberStatus" NOT NULL DEFAULT 'INVITED',
  "invitedByUserId" TEXT,
  "respondedAt"     TIMESTAMP(3),
  "joinedAt"        TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollaborationGroupMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollaborationGroupAuditLog" (
  "id"           TEXT NOT NULL,
  "groupId"      TEXT NOT NULL,
  "actorUserId"  TEXT NOT NULL,
  "eventType"    TEXT NOT NULL,
  "eventPayload" JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollaborationGroupAuditLog_pkey" PRIMARY KEY ("id")
);

-- Add groupId to Channel and Conversation
ALTER TABLE "Channel"      ADD COLUMN "groupId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "groupId" TEXT;

-- Indexes
CREATE INDEX "CollaborationGroup_status_idx"
  ON "CollaborationGroup"("status");

CREATE UNIQUE INDEX "CollaborationGroupMembership_groupId_workspaceId_key"
  ON "CollaborationGroupMembership"("groupId", "workspaceId");
CREATE INDEX "CollaborationGroupMembership_groupId_status_idx"
  ON "CollaborationGroupMembership"("groupId", "status");
CREATE INDEX "CollaborationGroupMembership_workspaceId_status_idx"
  ON "CollaborationGroupMembership"("workspaceId", "status");

CREATE INDEX "CollaborationGroupAuditLog_groupId_createdAt_idx"
  ON "CollaborationGroupAuditLog"("groupId", "createdAt");

CREATE INDEX "Channel_groupId_idx"      ON "Channel"("groupId");
CREATE INDEX "Conversation_groupId_idx" ON "Conversation"("groupId");

-- Foreign keys: CollaborationGroup
ALTER TABLE "CollaborationGroup"
  ADD CONSTRAINT "CollaborationGroup_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "CollaborationPolicy"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CollaborationGroup"
  ADD CONSTRAINT "CollaborationGroup_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign keys: CollaborationGroupMembership
ALTER TABLE "CollaborationGroupMembership"
  ADD CONSTRAINT "CollaborationGroupMembership_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "CollaborationGroup"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CollaborationGroupMembership"
  ADD CONSTRAINT "CollaborationGroupMembership_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CollaborationGroupMembership"
  ADD CONSTRAINT "CollaborationGroupMembership_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign keys: CollaborationGroupAuditLog
ALTER TABLE "CollaborationGroupAuditLog"
  ADD CONSTRAINT "CollaborationGroupAuditLog_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "CollaborationGroup"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CollaborationGroupAuditLog"
  ADD CONSTRAINT "CollaborationGroupAuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign keys: Channel.groupId and Conversation.groupId
ALTER TABLE "Channel"
  ADD CONSTRAINT "Channel_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "CollaborationGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "CollaborationGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
