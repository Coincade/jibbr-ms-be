CREATE TYPE "WorkspaceCollaborationRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'REVOKED', 'EXPIRED');
CREATE TYPE "WorkspaceCollaborationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COLLABORATION_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COLLABORATION_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COLLABORATION_REVOKED';

CREATE TABLE "CollaborationPolicy" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "allowExternalDiscovery" BOOLEAN NOT NULL DEFAULT false,
  "allowCrossWorkspaceDm" BOOLEAN NOT NULL DEFAULT false,
  "allowSharedChannels" BOOLEAN NOT NULL DEFAULT false,
  "allowFileSharing" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollaborationPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceCollaboration" (
  "id" TEXT NOT NULL,
  "workspaceAId" TEXT NOT NULL,
  "workspaceBId" TEXT NOT NULL,
  "status" "WorkspaceCollaborationStatus" NOT NULL DEFAULT 'ACTIVE',
  "policyId" TEXT NOT NULL,
  "createdFromRequestId" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceCollaboration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceCollaborationRequest" (
  "id" TEXT NOT NULL,
  "requestingWorkspaceId" TEXT NOT NULL,
  "targetWorkspaceId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "respondedByUserId" TEXT,
  "status" "WorkspaceCollaborationRequestStatus" NOT NULL DEFAULT 'PENDING',
  "message" TEXT,
  "policyTemplate" JSONB,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "collaborationId" TEXT,
  CONSTRAINT "WorkspaceCollaborationRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollaborationAuditLog" (
  "id" TEXT NOT NULL,
  "collaborationId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollaborationAuditLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Channel" ADD COLUMN "collaborationId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "collaborationId" TEXT;

CREATE UNIQUE INDEX "WorkspaceCollaboration_createdFromRequestId_key" ON "WorkspaceCollaboration"("createdFromRequestId");
CREATE UNIQUE INDEX "WorkspaceCollaborationRequest_collaborationId_key" ON "WorkspaceCollaborationRequest"("collaborationId");

CREATE INDEX "CollaborationPolicy_createdByUserId_idx" ON "CollaborationPolicy"("createdByUserId");
CREATE INDEX "WorkspaceCollaboration_workspaceAId_status_idx" ON "WorkspaceCollaboration"("workspaceAId", "status");
CREATE INDEX "WorkspaceCollaboration_workspaceBId_status_idx" ON "WorkspaceCollaboration"("workspaceBId", "status");
CREATE INDEX "WorkspaceCollaboration_policyId_idx" ON "WorkspaceCollaboration"("policyId");
CREATE INDEX "WorkspaceCollaborationRequest_requestingWorkspaceId_status_idx" ON "WorkspaceCollaborationRequest"("requestingWorkspaceId", "status");
CREATE INDEX "WorkspaceCollaborationRequest_targetWorkspaceId_status_idx" ON "WorkspaceCollaborationRequest"("targetWorkspaceId", "status");
CREATE INDEX "WorkspaceCollaborationRequest_requestedByUserId_idx" ON "WorkspaceCollaborationRequest"("requestedByUserId");
CREATE INDEX "CollaborationAuditLog_collaborationId_createdAt_idx" ON "CollaborationAuditLog"("collaborationId", "createdAt");
CREATE INDEX "CollaborationAuditLog_actorUserId_createdAt_idx" ON "CollaborationAuditLog"("actorUserId", "createdAt");
CREATE INDEX "Channel_collaborationId_idx" ON "Channel"("collaborationId");
CREATE INDEX "Conversation_collaborationId_idx" ON "Conversation"("collaborationId");

CREATE UNIQUE INDEX "WorkspaceCollaboration_active_pair_key"
ON "WorkspaceCollaboration"("workspaceAId", "workspaceBId")
WHERE "status" = 'ACTIVE';

ALTER TABLE "CollaborationPolicy"
ADD CONSTRAINT "CollaborationPolicy_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkspaceCollaboration"
ADD CONSTRAINT "WorkspaceCollaboration_workspaceAId_fkey"
FOREIGN KEY ("workspaceAId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkspaceCollaboration"
ADD CONSTRAINT "WorkspaceCollaboration_workspaceBId_fkey"
FOREIGN KEY ("workspaceBId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkspaceCollaboration"
ADD CONSTRAINT "WorkspaceCollaboration_policyId_fkey"
FOREIGN KEY ("policyId") REFERENCES "CollaborationPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkspaceCollaboration"
ADD CONSTRAINT "WorkspaceCollaboration_createdFromRequestId_fkey"
FOREIGN KEY ("createdFromRequestId") REFERENCES "WorkspaceCollaborationRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkspaceCollaboration"
ADD CONSTRAINT "WorkspaceCollaboration_revokedByUserId_fkey"
FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkspaceCollaborationRequest"
ADD CONSTRAINT "WorkspaceCollaborationRequest_requestingWorkspaceId_fkey"
FOREIGN KEY ("requestingWorkspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkspaceCollaborationRequest"
ADD CONSTRAINT "WorkspaceCollaborationRequest_targetWorkspaceId_fkey"
FOREIGN KEY ("targetWorkspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkspaceCollaborationRequest"
ADD CONSTRAINT "WorkspaceCollaborationRequest_requestedByUserId_fkey"
FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkspaceCollaborationRequest"
ADD CONSTRAINT "WorkspaceCollaborationRequest_respondedByUserId_fkey"
FOREIGN KEY ("respondedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkspaceCollaborationRequest"
ADD CONSTRAINT "WorkspaceCollaborationRequest_collaborationId_fkey"
FOREIGN KEY ("collaborationId") REFERENCES "WorkspaceCollaboration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CollaborationAuditLog"
ADD CONSTRAINT "CollaborationAuditLog_collaborationId_fkey"
FOREIGN KEY ("collaborationId") REFERENCES "WorkspaceCollaboration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CollaborationAuditLog"
ADD CONSTRAINT "CollaborationAuditLog_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Channel"
ADD CONSTRAINT "Channel_collaborationId_fkey"
FOREIGN KEY ("collaborationId") REFERENCES "WorkspaceCollaboration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_collaborationId_fkey"
FOREIGN KEY ("collaborationId") REFERENCES "WorkspaceCollaboration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
