-- Both the pre-model budget check and the per-bot month view filter usage by bot and a
-- month window. Without this index those reads scan the space/user index instead.
CREATE INDEX "usage_records_botId_createdAt_idx" ON "usage_records"("botId", "createdAt");
