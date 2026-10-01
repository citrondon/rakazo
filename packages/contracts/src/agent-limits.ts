import * as z from "zod";

/**
 * The per-space agent fuse: how many tool calls one turn may spend. Provider-neutral and
 * deployment-wide — a space either stores its own number or inherits `MAX_TOOL_CALLS_PER_TURN`.
 * `null` inherits the deployment value, `0` means unlimited, `n > 0` is a hard limit of n calls.
 */

/** Upper bound for a stored space limit: a typo must not install a fuse that can never fire. */
export const MAX_TOOL_CALLS_LIMIT_CEILING = 100_000;

/** Stored space value: null inherits the deployment value, 0 means unlimited. */
export const MaxToolCallsPerTurnSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_TOOL_CALLS_LIMIT_CEILING)
  .nullable();

/**
 * Deployment fuse: unset, empty, non-numeric, or <= 0 means unlimited (0). Mirrors the Pi
 * runtime's env reader so the stored setting and the runtime cannot disagree on the fallback.
 */
export function parseToolCallLimit(raw: string | number | null | undefined): number {
  const value = typeof raw === "number" ? raw : raw?.trim();
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

/** A space value wins; null/undefined inherits the deployment value; 0 means unlimited. */
export function resolveToolCallLimit(
  spaceValue: number | null | undefined,
  deploymentValue: number,
): number {
  return spaceValue ?? deploymentValue;
}

/**
 * Settings draft to stored value: "" means unlimited (0); null means the draft is not a usable
 * whole number. The ceiling is enforced here, so the settings field and the schema agree.
 */
export function toolCallLimitFromDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (trimmed === "") return 0;
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed > MAX_TOOL_CALLS_LIMIT_CEILING) return null;
  return parsed;
}
