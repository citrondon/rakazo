import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { monthlyTokenBudgetExceeded } from "./executor.js";

/** A client whose usage aggregate is a mock, so the test can inspect the query it built. */
type PrismaWithUsage = PrismaClient & {
  usageRecord: { aggregate: ReturnType<typeof vi.fn> };
};

function prismaWithUsage(sum: {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}): PrismaWithUsage {
  const aggregate = vi.fn().mockResolvedValue({ _sum: sum });
  return { usageRecord: { aggregate } } as unknown as PrismaWithUsage;
}

describe("monthlyTokenBudgetExceeded", () => {
  it("allows the run when no budget is configured", async () => {
    const prisma = prismaWithUsage({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    const result = await monthlyTokenBudgetExceeded(prisma, {
      id: "bot-1",
      monthlyTokenBudget: null,
    });
    expect(result).toBeNull();
    expect(prisma.usageRecord.aggregate).not.toHaveBeenCalled();
  });

  it("allows the run when a zero budget is stored", async () => {
    const result = await monthlyTokenBudgetExceeded(
      prismaWithUsage({
        inputTokens: 10,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
      { id: "bot-1", monthlyTokenBudget: 0 },
    );
    expect(result).toBeNull();
  });

  it("counts input and output tokens against the budget", async () => {
    const prisma = prismaWithUsage({
      inputTokens: 700,
      outputTokens: 250,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    const result = await monthlyTokenBudgetExceeded(prisma, {
      id: "bot-1",
      monthlyTokenBudget: 1000,
    });
    expect(result).toBeNull();
    expect(prisma.usageRecord.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ botId: "bot-1" }),
      }),
    );
  });

  it("weights cache reads down and keeps cache writes at face value", async () => {
    const prisma = prismaWithUsage({
      inputTokens: 100,
      outputTokens: 100,
      cacheReadTokens: 500,
      cacheWriteTokens: 200,
    });
    // 100 + 100 + 200 + round(500 * 0.1) = 450, so a 900 ceiling is not reached yet.
    const result = await monthlyTokenBudgetExceeded(prisma, {
      id: "bot-1",
      monthlyTokenBudget: 900,
    });
    expect(result).toBeNull();
  });

  it("stops once the weighted total reaches the ceiling", async () => {
    const prisma = prismaWithUsage({
      inputTokens: 500,
      outputTokens: 300,
      cacheReadTokens: 500,
      cacheWriteTokens: 100,
    });
    // 500 + 300 + 100 + round(500 * 0.1) = 950 >= 900.
    const result = await monthlyTokenBudgetExceeded(prisma, {
      id: "bot-1",
      monthlyTokenBudget: 900,
    });
    expect(result).toMatch(/exhausted/);
  });

  it("stays silent while usage is under the budget", async () => {
    const prisma = prismaWithUsage({
      inputTokens: 300,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    const result = await monthlyTokenBudgetExceeded(prisma, {
      id: "bot-1",
      monthlyTokenBudget: 1000,
    });
    expect(result).toBeNull();
  });

  it("blocks once usage reaches the budget exactly", async () => {
    const prisma = prismaWithUsage({
      inputTokens: 600,
      outputTokens: 400,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    const result = await monthlyTokenBudgetExceeded(prisma, {
      id: "bot-1",
      monthlyTokenBudget: 1000,
    });
    expect(result).toMatch(/exhausted/);
  });

  it("scopes the usage window to the current UTC month", async () => {
    const aggregate = vi.fn().mockResolvedValue({
      _sum: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    await monthlyTokenBudgetExceeded({ usageRecord: { aggregate } } as never, {
      id: "bot-1",
      monthlyTokenBudget: 100,
    });
    const where = aggregate.mock.calls[0]?.[0]?.where;
    expect(where.botId).toBe("bot-1");
    expect(where.createdAt.gte.getUTCDate()).toBe(1);
    expect(where.createdAt.gte.getUTCHours()).toBe(0);
  });
});
