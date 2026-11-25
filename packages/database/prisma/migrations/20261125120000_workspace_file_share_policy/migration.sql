-- Workspace admins choose an upload size and which file kinds members can share.
ALTER TABLE "Workspace" ADD COLUMN "fileUploadMaxMb" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "Workspace" ADD COLUMN "allowedFileTypes" TEXT[] NOT NULL DEFAULT ARRAY['images', 'pdf', 'word', 'spreadsheets', 'presentations']::TEXT[];
