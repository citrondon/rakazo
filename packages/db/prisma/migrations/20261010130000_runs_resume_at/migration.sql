-- AlterTable
ALTER TABLE "runs" ADD COLUMN "resumeAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "runs_status_resumeAt_idx" ON "runs"("status", "resumeAt");
