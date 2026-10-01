import { resolveToolCallLimit, toolCallLimitFromDraft } from "@rakazo/contracts";

export interface AgentLimitPolicy {
  maxToolCallsPerTurn: number | null;
  maxToolCallsPerTurnDefault: number;
}

/** Text the field shows: a stored 0 or null both render empty, never "0". */
export function toolCallLimitDraft(policy: AgentLimitPolicy): string {
  return policy.maxToolCallsPerTurn ? String(policy.maxToolCallsPerTurn) : "";
}

/** The fuse that applies right now; 0 means unlimited (the screen renders "Unlimited"). */
export function toolCallLimitPlaceholder(policy: AgentLimitPolicy): number {
  return resolveToolCallLimit(policy.maxToolCallsPerTurn, policy.maxToolCallsPerTurnDefault);
}

export type ToolCallLimitSavePlan =
  | { kind: "invalid" }
  | { kind: "unchanged" }
  | { kind: "save"; maxToolCallsPerTurn: number };

/**
 * Empty draft means unlimited (0) — but only for a field that was actually edited. A draft equal to
 * what `toolCallLimitDraft` renders (e.g. `""` on a space inheriting `null`) is `unchanged`, so an
 * untouched blur can never silently write 0 and disable the deployment fuse.
 */
export function planToolCallLimitSave(
  policy: AgentLimitPolicy,
  draft: string,
): ToolCallLimitSavePlan {
  if (draft === toolCallLimitDraft(policy)) return { kind: "unchanged" };
  const parsed = toolCallLimitFromDraft(draft);
  if (parsed === null) return { kind: "invalid" };
  if (parsed === policy.maxToolCallsPerTurn) return { kind: "unchanged" };
  return { kind: "save", maxToolCallsPerTurn: parsed };
}
