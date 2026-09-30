import { describe, expect, it } from "vitest";
import {
  BUDGET_WARN_PERCENT,
  budgetUsedPercent,
  currentMonthStart,
  reachedBudgetWarnLine,
  runStopKind,
} from "./token-budget.js";

describe("currentMonthStart", () => {
  it("returns the first instant of the month in UTC", () => {
    expect(currentMonthStart(new Date("2026-09-28T13:45:30.123Z")).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });

  it("keeps a timestamp that is already the month start", () => {
    expect(currentMonthStart(new Date("2026-01-01T00:00:00.000Z")).toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("uses the UTC month, not the local one", () => {
    // Late on the last day of a month in a positive offset, this is already next month in UTC.
    expect(currentMonthStart(new Date("2026-09-30T23:30:00.000Z")).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });
});

describe("budgetUsedPercent", () => {
  it("reports null for a bot without a ceiling", () => {
    expect(budgetUsedPercent(5_000, null)).toBeNull();
    expect(budgetUsedPercent(5_000, undefined)).toBeNull();
    expect(budgetUsedPercent(5_000, 0)).toBeNull();
  });

  it("rounds the share of the ceiling", () => {
    expect(budgetUsedPercent(500, 1_000)).toBe(50);
    expect(budgetUsedPercent(1_000, 1_000)).toBe(100);
    expect(budgetUsedPercent(805, 1_000)).toBe(81);
    expect(budgetUsedPercent(0, 1_000)).toBe(0);
  });
});

describe("reachedBudgetWarnLine", () => {
  it("never warns a bot without a ceiling", () => {
    expect(reachedBudgetWarnLine(1_000_000, null)).toBe(false);
    expect(reachedBudgetWarnLine(1_000_000, 0)).toBe(false);
  });

  it("stays quiet below the share", () => {
    expect(reachedBudgetWarnLine((1_000 * BUDGET_WARN_PERCENT) / 100 - 1, 1_000)).toBe(false);
  });

  it("fires exactly at the share and above", () => {
    expect(reachedBudgetWarnLine((1_000 * BUDGET_WARN_PERCENT) / 100, 1_000)).toBe(true);
    expect(reachedBudgetWarnLine(1_000, 1_000)).toBe(true);
    expect(reachedBudgetWarnLine(5_000, 1_000)).toBe(true);
  });

  it("does not round into a warning", () => {
    // 79.6% would round to 80, but the ceiling is not actually reached.
    expect(reachedBudgetWarnLine(796, 1_000)).toBe(false);
    expect(reachedBudgetWarnLine(800, 1_000)).toBe(true);
  });
});

describe("runStopKind", () => {
  it("classifies a budget stop from the message the executor writes", () => {
    expect(runStopKind("Monthly token budget exhausted for this bot (1 of 2 tokens used)")).toBe(
      "budget",
    );
    expect(runStopKind("Monthly token budget exhausted")).toBe("budget");
  });

  it("treats other stops, and no message, as non-budget", () => {
    expect(runStopKind("This bot has no model selected.")).toBe("other");
    expect(runStopKind(null)).toBe("other");
    expect(runStopKind(undefined)).toBe("other");
  });
});
