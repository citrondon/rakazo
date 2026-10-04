import type { ActionApprovalRule } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import { buildActionDecisionRow } from "./action-decision-row.js";

const resolved = {
  decision: "allow" as const,
  source: "default" as const,
  matchingRules: [],
};

/**
 * The rule resolution copies the caller's rule objects verbatim, so a real outcome can carry the
 * stored row's own columns. They must never reach the recorded JSON.
 */
type StoredRuleRow = ActionApprovalRule & { id: string; createdAt: string };

const storedAlwaysAllow: StoredRuleRow = {
  id: "rule-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  effect: "always_allow",
  matchKind: "tool",
  matchValue: "destination.write",
};

describe("buildActionDecisionRow", () => {
  it("marks a silent default allow as something fail-closed would have stopped", () => {
    const row = buildActionDecisionRow({
      spaceId: "space-1",
      botId: "bot-1",
      toolName: "gmail_send_email",
      connectorKind: "gmail",
      resolved,
      gateDecision: "allow",
      failClosed: false,
    });
    expect(row.decision).toBe("allow");
    expect(row.source).toBe("default");
    expect(row.enforced).toBe(false);
    expect(row.wouldDeny).toBe(true);
  });

  it("never reports wouldDeny once fail-closed is in force", () => {
    const row = buildActionDecisionRow({
      spaceId: "space-1",
      botId: "bot-1",
      toolName: "gmail_send_email",
      connectorKind: "gmail",
      resolved: { ...resolved, decision: "ask" },
      gateDecision: "ask",
      failClosed: true,
    });
    expect(row.enforced).toBe(true);
    expect(row.wouldDeny).toBe(false);
  });

  it("leaves wouldDeny false when a rule decided the outcome", () => {
    const row = buildActionDecisionRow({
      spaceId: "space-1",
      botId: "bot-1",
      toolName: "destination.write",
      connectorKind: "destination",
      resolved: {
        decision: "allow",
        source: "always_allow",
        matchingRules: [storedAlwaysAllow],
      },
      gateDecision: "allow",
      failClosed: false,
    });
    expect(row.wouldDeny).toBe(false);
    expect(row.matchingRules).toEqual([
      { effect: "always_allow", matchKind: "tool", matchValue: "destination.write" },
    ]);
  });

  it("never counts a would-deny on a deployment that is already fail-closed", () => {
    // The judge let a default-source tool through despite the fail-closed flag: enforced wins.
    const row = buildActionDecisionRow({
      spaceId: "space-1",
      botId: "bot-1",
      toolName: "gmail_send_email",
      connectorKind: "gmail",
      resolved,
      gateDecision: "allow",
      failClosed: true,
    });
    expect(row.enforced).toBe(true);
    expect(row.wouldDeny).toBe(false);
  });

  it("never reports wouldDeny for an ask that the gate already raised", () => {
    const row = buildActionDecisionRow({
      spaceId: "space-1",
      botId: "bot-1",
      toolName: "gmail_send_email",
      connectorKind: "gmail",
      resolved: { ...resolved, decision: "ask" },
      gateDecision: "ask",
      failClosed: false,
    });
    expect(row.enforced).toBe(false);
    expect(row.wouldDeny).toBe(false);
  });

  it("records the gate's final decision, not the rule resolution's", () => {
    // A default allow that auto-review escalated to an ask.
    const row = buildActionDecisionRow({
      spaceId: "space-1",
      botId: "bot-1",
      threadId: "thread-1",
      runId: "run-1",
      toolName: "gmail_send_email",
      connectorKind: "gmail",
      resolved,
      gateDecision: "ask",
      failClosed: false,
    });
    expect(row.decision).toBe("ask");
    expect(row.source).toBe("default");
    expect(row.wouldDeny).toBe(false);
    expect(row.threadId).toBe("thread-1");
    expect(row.runId).toBe("run-1");
  });

  it("keeps a missing thread, run and effect as null, not empty string", () => {
    const row = buildActionDecisionRow({
      spaceId: "space-1",
      botId: "bot-1",
      toolName: "some_tool",
      connectorKind: "some",
      resolved,
      gateDecision: "allow",
      failClosed: false,
    });
    expect(row.threadId).toBeNull();
    expect(row.runId).toBeNull();
    expect(row.effectId).toBeNull();
  });

  it("passes a provided effect id through unchanged", () => {
    const row = buildActionDecisionRow({
      spaceId: "space-1",
      botId: "bot-1",
      toolName: "some_tool",
      connectorKind: "some",
      effectId: "effect-1",
      resolved,
      gateDecision: "allow",
      failClosed: false,
    });
    expect(row.effectId).toBe("effect-1");
  });
});
