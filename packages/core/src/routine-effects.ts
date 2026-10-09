import type { TrustEffect, TrustEffectAction } from "@bobbot/contracts";
import { toolRequiresApproval, unattendedTriggerToolRequiresApproval } from "./action-approval.js";
import { effectRisk } from "./trust-effects.js";

/**
 * The effects a routine's run may reach, derived before it starts.
 *
 * The pre-run path cannot resolve live tools (that needs a provider and the network), so it
 * describes what the bot can reach at the granularity it has: a connected integration's
 * provider, or an installed API's name. A tool that might write is planned as a write, so the
 * plan never understates risk. Pure and offline: the same descriptors always yield the same
 * plan, so a routine's safety is checkable without a provider, a computer, or the network.
 */

/** One tool the agent can reach, as the pre-run path knows it. */
export type RoutineToolDescriptor = {
  name: string;
  /** True when the tool comes from a connected integration rather than the builtin catalog. */
  viaConnector: boolean;
  /** A connector tool's declared read/write hint, when the install exposes one. */
  readOnly?: boolean;
};

/** Irreversible verbs map to the top risk tier rather than a reversible write. */
const DESTRUCTIVE_ACTION_PATTERNS: ReadonlyArray<[RegExp, TrustEffectAction]> = [
  [/(^|_)(delete|archive|remove|forget|revoke|unlink|unassign|unsubscribe|cancel)(_|$)/i, "delete"],
  [
    /(^|_)(transfer|share|grant|invite|publish|deploy|send|post|reply|merge|commit|push|pay|charge)(_|$)/i,
    "publish",
  ],
];

function actionForApprovalRequiredTool(name: string): TrustEffectAction {
  for (const [pattern, action] of DESTRUCTIVE_ACTION_PATTERNS) {
    if (pattern.test(name)) return action;
  }
  return "update";
}

/**
 * Whether a tool is consequential for an *unattended* triggered run. Combines the general
 * approval rule with the unattended boundary (an external wake must not run side effects
 * unattended), so a builtin such as `shell` counts as a write even though an attended run may
 * use it freely.
 */
function requiresApprovalForUnattendedRun(descriptor: RoutineToolDescriptor): boolean {
  return (
    toolRequiresApproval(descriptor.name, descriptor.viaConnector, descriptor.readOnly) ||
    unattendedTriggerToolRequiresApproval(
      "webhook",
      descriptor.name,
      descriptor.viaConnector,
      descriptor.readOnly,
    )
  );
}

/** The effect one tool maps to: a read when it is harmless unattended, else a write at its tier. */
export function toolTrustAction(descriptor: RoutineToolDescriptor): TrustEffectAction {
  return requiresApprovalForUnattendedRun(descriptor)
    ? actionForApprovalRequiredTool(descriptor.name)
    : "read";
}

/**
 * Plan the effects a routine may reach, from the tools its bot can call. A tool that needs
 * approval is planned as a mutating effect at its risk tier; a read-only tool is planned as a
 * read. Duplicate action/target pairs collapse, so the plan stays short and stable.
 */
export function planRoutineEffects(descriptors: readonly RoutineToolDescriptor[]): TrustEffect[] {
  const effects: TrustEffect[] = [];
  const seen = new Set<string>();
  for (const descriptor of descriptors) {
    const action = toolTrustAction(descriptor);
    const key = `${action}:${descriptor.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    effects.push({ action, target: descriptor.name, risk: effectRisk(action) });
  }
  return effects;
}
