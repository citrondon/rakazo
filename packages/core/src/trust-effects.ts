import type {
  QuietHours,
  TrustEffect,
  TrustEffectAction,
  TrustPolicy,
  TrustRisk,
} from "@rakazo/contracts";

/**
 * The trust kit's arithmetic: how risky a planned effect is, whether that risk crosses the
 * policy's approval line, and whether a quiet window means a routine should pause instead.
 * Kept pure so the API, the worker, and the conformance tests share one source of truth.
 */

const RISK_RANK: Record<TrustRisk, number> = { low: 0, medium: 1, high: 2 };

/**
 * The policy a space gets before it stores its own: ask before any write (medium and above),
 * and never pause. One source of truth, so storage, the API, and the runner cannot drift.
 */
export const DEFAULT_TRUST_POLICY: TrustPolicy = {
  approvalThreshold: "medium",
  quietHours: null,
};

/** Fill a partial or absent policy with the defaults, so callers never branch on missing fields. */
export function resolveTrustPolicy(partial: Partial<TrustPolicy> | null | undefined): TrustPolicy {
  return {
    approvalThreshold: partial?.approvalThreshold ?? DEFAULT_TRUST_POLICY.approvalThreshold,
    quietHours: partial?.quietHours ?? DEFAULT_TRUST_POLICY.quietHours,
  };
}

/**
 * Risk is derived from what the action does, not from the provider. Reading, listing, and
 * drafting leave the world unchanged; creating, updating, and notifying are reversible
 * writes; deleting, transferring, and publishing are the tiers that ask a person by default.
 */
export const EFFECT_RISK: Record<TrustEffectAction, TrustRisk> = {
  read: "low",
  list: "low",
  draft: "low",
  create: "medium",
  update: "medium",
  notify: "medium",
  delete: "high",
  transfer: "high",
  publish: "high",
};

/** Actions a dry run must never actually apply. */
export const MUTATING_ACTIONS: ReadonlySet<TrustEffectAction> = new Set<TrustEffectAction>([
  "create",
  "update",
  "notify",
  "delete",
  "transfer",
  "publish",
]);

export function effectRisk(action: TrustEffectAction): TrustRisk {
  return EFFECT_RISK[action];
}

export function isMutating(action: TrustEffectAction): boolean {
  return MUTATING_ACTIONS.has(action);
}

export function riskRank(risk: TrustRisk): number {
  return RISK_RANK[risk];
}

/** The worst tier among the planned effects; `low` when there are none. */
export function highestRisk(effects: readonly TrustEffect[]): TrustRisk {
  return effects.reduce<TrustRisk>(
    (worst, effect) => (riskRank(effect.risk) > riskRank(worst) ? effect.risk : worst),
    "low",
  );
}

/** True when a risk tier reaches the policy's approval line. */
export function requiresApproval(risk: TrustRisk, policy: TrustPolicy): boolean {
  return riskRank(risk) >= riskRank(policy.approvalThreshold);
}

/** True when any planned effect reaches the policy's approval line. */
export function policyRequiresApproval(
  effects: readonly TrustEffect[],
  policy: TrustPolicy,
): boolean {
  return requiresApproval(highestRisk(effects), policy);
}

/** `HH:MM` to minutes past local midnight, or null when the clock is malformed. */
export function parseClockMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function validTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return "UTC";
  }
}

/** Minutes past local midnight for a moment in the given timezone. */
export function minutesOfDay(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: validTimezone(timezone),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/** True when a moment falls inside the quiet window; a window that wraps midnight is handled. */
export function withinQuietHours(date: Date, window: QuietHours): boolean {
  const start = parseClockMinutes(window.start);
  const end = parseClockMinutes(window.end);
  if (start === null || end === null || start === end) return false;
  const now = minutesOfDay(date, window.timezone);
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

/**
 * Whether a routine with these planned effects should run now or pause for the quiet
 * window. Only effects that would otherwise require approval are held: a routine that only
 * reads is left alone, so quiet hours silence the consequential work rather than all work.
 */
export function planQuietHours(
  effects: readonly TrustEffect[],
  policy: TrustPolicy,
  now: Date,
): "run" | "pause" {
  if (!policy.quietHours) return "run";
  if (!policyRequiresApproval(effects, policy)) return "run";
  return withinQuietHours(now, policy.quietHours) ? "pause" : "run";
}
