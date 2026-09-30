import { ACTIVE_RUN_STATUSES } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";

/**
 * How long finished runs stay queryable. Long enough that "what did the bot do in
 * March" still answers, short enough that an hourly routine cannot grow the run,
 * attempt, effect, and progress-event tables without bound.
 */
const DEFAULT_RETENTION_DAYS = 120;

/** Batch so one sweep cannot hold row locks over a large table for seconds. */
const BATCH_SIZE = 500;

/**
 * Delete finished runs older than the retention window, oldest first. Active runs are
 * never touched regardless of age, so a long-parked approval survives a long sweep.
 * Attempts, effects, and steering messages cascade with their run; usage rows keep
 * their token counts (their `runId` goes null) because spend really happened; thread
 * events are NOT deleted here — the transcript is a chat surface, not run bookkeeping.
 */
export async function pruneRunHistory(prisma: PrismaClient, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DEFAULT_RETENTION_DAYS * 24 * 60 * 60_000);
  let deleted = 0;
  // Loop bounded: when one batch deletes fewer rows than asked for, the table has no
  // more prunable runs, so stopping there cannot strand the rest for a whole day.
  while (deleted < 100_000) {
    const batch = await prisma.run.findMany({
      where: {
        status: { notIn: [...ACTIVE_RUN_STATUSES] },
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
      orderBy: { updatedAt: "asc" },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;
    const result = await prisma.run.deleteMany({
      where: { id: { in: batch.map((run) => run.id) } },
    });
    deleted += result.count;
    if (result.count < batch.length) break;
  }
  if (deleted > 0) {
    getLogger().info(`run retention: pruned ${deleted} finished runs`);
  }
  return deleted;
}
