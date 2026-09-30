-- CreateTable
CREATE TABLE "triggers" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT,
    "filter" JSONB NOT NULL DEFAULT '{"predicates":[]}',
    "mappings" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "triggers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "triggers_routineId_idx" ON "triggers"("routineId");

-- CreateIndex
CREATE INDEX "triggers_spaceId_provider_eventType_enabled_idx" ON "triggers"("spaceId", "provider", "eventType", "enabled");

-- AddForeignKey
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;