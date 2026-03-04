-- AlterTable
ALTER TABLE "User" ADD COLUMN     "birthday" TIMESTAMP(3),
ADD COLUMN     "designation" VARCHAR(128),
ADD COLUMN     "employeeId" VARCHAR(64),
ADD COLUMN     "phone" VARCHAR(32);
