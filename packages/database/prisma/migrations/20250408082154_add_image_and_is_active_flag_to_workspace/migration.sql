-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "image" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;
