-- AlterTable
ALTER TABLE "System" ADD COLUMN     "proxyAutoswitch" TEXT NOT NULL DEFAULT 'off';

-- CreateTable
CREATE TABLE "Switch" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Switch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwitchMember" (
    "id" TEXT NOT NULL,
    "switchId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "SwitchMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Switch_systemId_timestamp_idx" ON "Switch"("systemId", "timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SwitchMember_switchId_memberId_key" ON "SwitchMember"("switchId", "memberId");

-- AddForeignKey
ALTER TABLE "Switch" ADD CONSTRAINT "Switch_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwitchMember" ADD CONSTRAINT "SwitchMember_switchId_fkey" FOREIGN KEY ("switchId") REFERENCES "Switch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwitchMember" ADD CONSTRAINT "SwitchMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
