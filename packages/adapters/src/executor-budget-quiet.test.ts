import { runStopKind } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import {
  claimBudgetWarning,
  monthlyTokenBudgetExceeded,
  monthlyTokensUsed,
  releaseBudgetWarning,
} from "./executor.js";

/** Only the two delegates these helpers touch, so a test can inspect the queries they build. */
type PrismaStub = PrismaClient & {
  bot: { updateMany: ReturnType<typeof vi.fn> };
  usageRecord: { aggregate: ReturnType<typeof vi.fn> };
};

function prismaStub(): PrismaStub {
  return {
    bot: { updateMany: vi.fn() },
    usageRecord: { aggregate: vi.fn() },
  } as unknown as PrismaStub;
}

describe("runStopKind", () => {
  it("classifies an exhausted-budget stop from the message the executor writes", async () => {
    const message = await monthlyTokenBudgetExceeded(
      {
        usageRecord: {
          aggregate: vi.fn().mockResolvedValue({
            _sum: { inputTokens: 600, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 },
          }),
        },
      } as never,
      { id: "bot-1", monthlyTokenBudget: 1000 },
    );
    expect(message).not.toBeNull();
    expect(runStopKind(message!)).toBe("budget");
  });

  it("keeps other pre-model stops notifying", () => {
    expect(runStopKind("This bot has no model selected.")).toBe("other");
    expect(runStopKind("The saved model is unavailable for this account.")).toBe("other");
  });
});

describe("monthlyTokensUsed", () => {
  it("counts every token kind inside the current UTC month", async () => {
    const prisma = prismaStub();
    prisma.usageRecord.aggregate.mockResolvedValue({
      _sum: { inputTokens: 100, outputTokens: 200, cacheReadTokens: 30, cacheWriteTokens: 5 },
    });
    await expect(monthlyTokensUsed(prisma, "bot-1")).resolves.toBe(335);
    const where = prisma.usageRecord.aggregate.mock.calls[0]?.[0]?.where;
    expect(where.botId).toBe("bot-1");
    expect(where.createdAt.gte.getUTCDate()).toBe(1);
    expect(where.createdAt.gte.getUTCHours()).toBe(0);
  });

  it("treats missing sums as zero tokens", async () => {
    const prisma = prismaStub();
    prisma.usageRecord.aggregate.mockResolvedValue({ _sum: {} });
    await expect(monthlyTokensUsed(prisma, "bot-1")).resolves.toBe(0);
  });
});

describe("claimBudgetWarning", () => {
  it("claims this month's warning with a conditional update", async () => {
    const prisma = prismaStub();
    prisma.bot.updateMany.mockResolvedValue({ count: 1 });
    await expect(claimBudgetWarning(prisma, "bot-1")).resolves.toBe(true);
    const call = prisma.bot.updateMany.mock.calls[0]?.[0];
    expect(call.where.id).toBe("bot-1");
    // An unclaimed bot, or one warned in an earlier month, can still claim. A bot already
    // warned this month cannot, which is what keeps the warning to one per month.
    expect(call.where.OR).toHaveLength(2);
    expect(call.where.OR[0]).toEqual({ budgetWarnedAt: null });
    expect(call.where.OR[1].budgetWarnedAt.lt.getUTCDate()).toBe(1);
    expect(call.where.OR[1].budgetWarnedAt.lt.getUTCHours()).toBe(0);
    expect(call.data.budgetWarnedAt).toBeInstanceOf(Date);
  });

  it("reports no claim when a run already warned this month", async () => {
    const prisma = prismaStub();
    prisma.bot.updateMany.mockResolvedValue({ count: 0 });
    await expect(claimBudgetWarning(prisma, "bot-1")).resolves.toBe(false);
  });
});

describe("releaseBudgetWarning", () => {
  it("hands the claim back so a later run still warns", async () => {
    const prisma = prismaStub();
    prisma.bot.updateMany.mockResolvedValue({ count: 1 });
    await releaseBudgetWarning(prisma, "bot-1");
    const call = prisma.bot.updateMany.mock.calls[0]?.[0];
    expect(call.where).toEqual({ id: "bot-1" });
    // Null is what claimBudgetWarning treats as unclaimed, so the next crossing run warns again.
    expect(call.data.budgetWarnedAt).toBeNull();
  });
});
