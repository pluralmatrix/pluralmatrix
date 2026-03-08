-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "pkId" TEXT,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_MemberGroups" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Group_systemId_slug_key" ON "Group"("systemId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Group_systemId_pkId_key" ON "Group"("systemId", "pkId");

-- CreateIndex
CREATE UNIQUE INDEX "_MemberGroups_AB_unique" ON "_MemberGroups"("A", "B");

-- CreateIndex
CREATE INDEX "_MemberGroups_B_index" ON "_MemberGroups"("B");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MemberGroups" ADD CONSTRAINT "_MemberGroups_A_fkey" FOREIGN KEY ("A") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MemberGroups" ADD CONSTRAINT "_MemberGroups_B_fkey" FOREIGN KEY ("B") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
