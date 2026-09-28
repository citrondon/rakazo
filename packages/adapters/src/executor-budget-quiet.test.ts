import { runStopKind } from "@rakazo/core";
import { describe, expect, it, vi } from "vitest";
import { monthlyTokenBudgetExceeded } from "./executor.js";

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
