-- Optional per-bot monthly token budget. Null means unlimited; see schema comment.
ALTER TABLE "bots" ADD COLUMN "monthlyTokenBudget" INTEGER;