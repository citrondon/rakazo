-- CreateTable
CREATE TABLE "trust_policies" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "approvalThreshold" TEXT NOT NULL DEFAULT 'medium',
    "quietHours" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trust_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trust_policies_spaceId_key" ON "trust_policies"("spaceId");

-- AddForeignKey
ALTER TABLE "trust_policies" ADD CONSTRAINT "trust_policies_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
