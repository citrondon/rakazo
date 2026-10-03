import type { ActionApprovalResolved, ActionApprovalSource } from "@rakazo/core";

export interface ActionGateOutcome {
  spaceId: string;
  botId: string;
  threadId?: string;
  runId?: string;
  toolName: string;
  connectorKind: string;
  resolved: ActionApprovalResolved;
  gateDecision: "ask" | "allow";
  failClosed: boolean;
}

export interface ActionDecisionRow {
  spaceId: string;
  botId: string;
  threadId: string | null;
  runId: string | null;
  toolName: string;
  connectorKind: string;
  decision: "ask" | "allow";
  source: ActionApprovalSource;
  enforced: boolean;
  wouldDeny: boolean;
  matchingRules: { effect: string; matchKind: string; matchValue: string }[];
}

/**
 * `wouldDeny` is the measurement that makes the flip safe: it is true only for a run that was
 * allowed silently, so an operator can count what fail-closed would stop before turning it on.
 */
export function buildActionDecisionRow(outcome: ActionGateOutcome): ActionDecisionRow {
  return {
    spaceId: outcome.spaceId,
    botId: outcome.botId,
    threadId: outcome.threadId ?? null,
    runId: outcome.runId ?? null,
    toolName: outcome.toolName,
    connectorKind: outcome.connectorKind,
    decision: outcome.gateDecision,
    source: outcome.resolved.source,
    enforced: outcome.failClosed,
    wouldDeny:
      !outcome.failClosed &&
      outcome.gateDecision === "allow" &&
      outcome.resolved.source === "default",
    matchingRules: outcome.resolved.matchingRules.map((rule) => ({
      effect: rule.effect,
      matchKind: rule.matchKind,
      matchValue: rule.matchValue,
    })),
  };
}
