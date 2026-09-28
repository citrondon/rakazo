-- Records the month's budget warning so the owner is told once, not on every run. A new
-- ceiling clears it, because the warning line moves with the ceiling.
ALTER TABLE "bots" ADD COLUMN "budgetWarnedAt" TIMESTAMP(3);
