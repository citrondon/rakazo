/**
 * How a bot's monthly token budget is measured and reported. The window, the warning line,
 * and the "why it stopped" classification live here so the executor, the API, and the web
 * client agree without each keeping its own copy of the arithmetic.
 */

/** Start of the month a budget is counted in, in UTC. */
export function currentMonthStart(now = new Date()): Date {
  const start = new Date(now);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/**
 * Share of a bot's ceiling already used, rounded, or null when it has no ceiling. Null is
 * distinct from 0: a bot without a budget has no share to report.
 */
export function budgetUsedPercent(
  totalTokens: number,
  monthlyTokenBudget: number | null | undefined,
): number | null {
  if (!monthlyTokenBudget || monthlyTokenBudget <= 0) return null;
  return Math.round((totalTokens / monthlyTokenBudget) * 100);
}

/** Share of a bot's monthly ceiling where its owner is warned, before work stops. */
export const BUDGET_WARN_PERCENT = 80;

/** True once usage reaches the share of the ceiling where the owner is warned. */
export function reachedBudgetWarnLine(
  totalTokens: number,
  monthlyTokenBudget: number | null | undefined,
): boolean {
  if (!monthlyTokenBudget || monthlyTokenBudget <= 0) return false;
  return totalTokens * 100 >= monthlyTokenBudget * BUDGET_WARN_PERCENT;
}

/** Start of the message that marks a run stopped by its bot's token ceiling. */
export const BUDGET_STOP_PREFIX = "Monthly token budget exhausted";

/** Classify a run stop reason from the message the executor recorded. */
export function runStopKind(message: string | null | undefined): "budget" | "other" {
  return message?.startsWith(BUDGET_STOP_PREFIX) ? "budget" : "other";
}
