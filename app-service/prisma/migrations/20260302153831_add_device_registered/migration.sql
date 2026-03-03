-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "deviceRegistered" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "System" ADD COLUMN     "deviceRegistered" BOOLEAN NOT NULL DEFAULT false;

