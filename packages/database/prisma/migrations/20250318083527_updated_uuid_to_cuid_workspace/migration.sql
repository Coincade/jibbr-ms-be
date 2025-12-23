/*
  Warnings:

  - You are about to alter the column `JoinCode` on the `Workspace` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(6)`.

*/
-- DropIndex
DROP INDEX "Workspace_JoinCode_key";

-- DropIndex
DROP INDEX "Workspace_id_key";

-- AlterTable
ALTER TABLE "Workspace" ALTER COLUMN "JoinCode" SET DATA TYPE VARCHAR(6);
