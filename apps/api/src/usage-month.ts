import {
  type Actor,
  type BotUsageSummary,
  countedTokens,
  type UsageMonth,
} from "@rakazo/contracts";
import { currentMonthStart } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";

/** Share of a bot's ceiling already used. Null when the bot has no ceiling. */
export function usedPercent(totalTokens: number, monthlyTokenBudget: number | null): number | null {
  if (!monthlyTokenBudget || monthlyTokenBudget <= 0) return null;
  return Math.round((totalTokens / monthlyTokenBudget) * 100);
}

interface TokenSums {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

function tokenTotals(sums: TokenSums | undefined) {
  const inputTokens = sums?.inputTokens ?? 0;
  const outputTokens = sums?.outputTokens ?? 0;
  const cacheReadTokens = sums?.cacheReadTokens ?? 0;
  const cacheWriteTokens = sums?.cacheWriteTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: countedTokens({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }),
  };
}

/**
 * Token use for the current UTC month, per bot, next to the ceiling that bounds it.
 * Grouping by bot and run counts distinct runs without loading every usage row, and a
 * bot without spend still appears so its remaining budget stays visible.
 */
export async function loadUsageMonth(
  prisma: PrismaClient,
  actor: Actor,
  now = new Date(),
): Promise<UsageMonth> {
  const monthStart = currentMonthStart(now);
  const [bots, groups] = await Promise.all([
    prisma.bot.findMany({
      where: { spaceId: actor.spaceId, userId: actor.userId },
      select: { id: true, name: true, archivedAt: true, monthlyTokenBudget: true },
    }),
    prisma.usageRecord.groupBy({
      by: ["botId", "runId"],
      where: { spaceId: actor.spaceId, userId: actor.userId, createdAt: { gte: monthStart } },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
      },
    }),
  ]);

  const byBot = new Map<
    string | null,
    { tokenTotals: ReturnType<typeof tokenTotals>; runs: number }
  >();
  for (const group of groups) {
    const key = group.botId;
    const entry = byBot.get(key) ?? { tokenTotals: tokenTotals(undefined), runs: 0 };
    const tokens = tokenTotals(group._sum);
    entry.tokenTotals.inputTokens += tokens.inputTokens;
    entry.tokenTotals.outputTokens += tokens.outputTokens;
    entry.tokenTotals.cacheReadTokens += tokens.cacheReadTokens;
    entry.tokenTotals.cacheWriteTokens += tokens.cacheWriteTokens;
    entry.tokenTotals.totalTokens += tokens.totalTokens;
    // A usage row without a run is spend that happened outside a countable run.
    if (group.runId) entry.runs += 1;
    byBot.set(key, entry);
  }

  const knownBotIds = new Set(bots.map((bot) => bot.id));
  const missingBotIds = [...byBot.keys()].filter(
    (botId): botId is string => botId !== null && !knownBotIds.has(botId),
  );
  // A usage row outlives its bot, so a deleted bot's name comes from its tombstone.
  const tombstones = missingBotIds.length
    ? await prisma.botDeletion.findMany({
        where: { id: { in: missingBotIds }, spaceId: actor.spaceId },
        select: { id: true, name: true },
      })
    : [];
  const tombstoneNames = new Map(tombstones.map((row) => [row.id, row.name]));

  const summaries: BotUsageSummary[] = bots.map((bot) => {
    const entry = byBot.get(bot.id);
    const totals = entry?.tokenTotals ?? tokenTotals(undefined);
    const budget = bot.monthlyTokenBudget ?? null;
    return {
      botId: bot.id,
      botName: bot.name,
      archived: bot.archivedAt !== null,
      ...totals,
      runs: entry?.runs ?? 0,
      monthlyTokenBudget: budget && budget > 0 ? budget : null,
      usedPercent: usedPercent(totals.totalTokens, budget && budget > 0 ? budget : null),
    };
  });
  for (const botId of missingBotIds) {
    const entry = byBot.get(botId);
    if (!entry) continue;
    summaries.push({
      botId,
      botName: tombstoneNames.get(botId) ?? "",
      archived: true,
      ...entry.tokenTotals,
      runs: entry.runs,
      monthlyTokenBudget: null,
      usedPercent: null,
    });
  }
  summaries.sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) ||
      b.totalTokens - a.totalTokens ||
      a.botName.localeCompare(b.botName),
  );

  const totals = { ...tokenTotals(undefined), runs: 0 };
  for (const entry of byBot.values()) {
    totals.inputTokens += entry.tokenTotals.inputTokens;
    totals.outputTokens += entry.tokenTotals.outputTokens;
    totals.cacheReadTokens += entry.tokenTotals.cacheReadTokens;
    totals.cacheWriteTokens += entry.tokenTotals.cacheWriteTokens;
    totals.totalTokens += entry.tokenTotals.totalTokens;
    totals.runs += entry.runs;
  }

  return { monthStart: monthStart.toISOString(), bots: summaries, totals };
}
