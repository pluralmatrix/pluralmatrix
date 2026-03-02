-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "pkId" TEXT;

-- AlterTable
ALTER TABLE "System" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "banner" TEXT,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "pkId" TEXT,
ADD COLUMN     "pronouns" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Member_systemId_pkId_key" ON "Member"("systemId", "pkId");

