-- CreateEnum
CREATE TYPE "UserPresenceStatus" AS ENUM ('available', 'away', 'in_a_meeting', 'do_not_disturb', 'custom');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "presenceStatus" "UserPresenceStatus" DEFAULT 'available',
ADD COLUMN "customStatusMessage" VARCHAR(100);
