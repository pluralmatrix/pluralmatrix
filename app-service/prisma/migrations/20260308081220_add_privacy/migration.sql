-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "privacy" JSONB;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "privacy" JSONB;

-- AlterTable
ALTER TABLE "System" ADD COLUMN     "privacy" JSONB;
