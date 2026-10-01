import type { TrustEffect, TrustPhase, TrustPolicy } from "@rakazo/contracts";
import { isMutating, planQuietHours, policyRequiresApproval } from "./trust-effects.js";

/**
 * The trust runner's phase machine. A triggered run is planned, previewed against a
 * deterministic dry run, approved when its effects reach the policy's line, and only then
 * executed. Pure and offline: the same plan and policy always yield the same phases, so a
 * routine's safety can be checked without a computer, a provider, or the network.
 */

/** Allowed moves between phases. Terminal phases have no successors except a fresh plan. */
export const TRUST_PHASE_TRANSITIONS: Record<TrustPhase, readonly TrustPhase[]> = {
  planned: ["dryRun", "paused", "rejected"],
  dryRun: ["approval", "executed", "paused", "rejected"],
  approval: ["executed", "rejected", "paused"],
  executed: [],
  rejected: ["planned"],
  paused: ["planned", "rejected"],
};

export function canAdvanceTrust(from: TrustPhase, to: TrustPhase): boolean {
  return TRUST_PHASE_TRANSITIONS[from].includes(to);
}

export function assertTrustTransition(from: TrustPhase, to: TrustPhase): void {
  if (!canAdvanceTrust(from, to)) {
    throw new Error(`Illegal trust transition ${from} -> ${to}`);
  }
}

/**
 * The phases a run must pass for its planned effects. Every run is planned then dry-run;
 * a run whose effects reach the policy's approval line goes through approval before it may
 * execute. A read-only run skips approval and executes straight from its dry run.
 */
export function planTrustPhases(
  effects: readonly TrustEffect[],
  policy: TrustPolicy,
): TrustPhase[] {
  const phases: TrustPhase[] = ["planned", "dryRun"];
  if (policyRequiresApproval(effects, policy)) phases.push("approval");
  phases.push("executed");
  return phases;
}

/** One planned effect as the dry run sees it, with whether the dry run actually applies it. */
export type DryRunEffect = { effect: TrustEffect; applied: boolean };

/**
 * Conformance contract: a dry run may read, list, or draft, but must never apply a
 * mutating effect. The preview keeps mutating effects so the interface can show what will
 * happen, and marks them unapplied, so `dryRunAppliedEffects` is provably side-effect free.
 */
export function dryRunPreview(effects: readonly TrustEffect[]): DryRunEffect[] {
  return effects.map((effect) => ({ effect, applied: !isMutating(effect.action) }));
}

/** Only the effects a dry run is allowed to apply: reads, lists, and drafts. */
export function dryRunAppliedEffects(effects: readonly TrustEffect[]): TrustEffect[] {
  return effects.filter((effect) => !isMutating(effect.action));
}

/** True when the dry run applies nothing that would mutate the outside world. */
export function isDryRunSideEffectFree(effects: readonly TrustEffect[]): boolean {
  return dryRunAppliedEffects(effects).every((effect) => !isMutating(effect.action));
}

/**
 * The phase a triggered run starts under, decided before it runs: a run whose effects would
 * reach the approval line is held when it lands inside the policy's quiet window, otherwise it
 * starts planned. A run that only reads is never held, so quiet hours silence the consequential
 * work rather than all work.
 */
export function planRunTrust(
  effects: readonly TrustEffect[],
  policy: TrustPolicy,
  now: Date,
): { phase: TrustPhase; paused: boolean } {
  const paused = planQuietHours(effects, policy, now) === "pause";
  return { phase: paused ? "paused" : "planned", paused };
}
