import { describe, expect, it } from "vitest";
import { buildActionDecisionRow } from "./action-decision-row.js";

const resolved = {
  decision: "allow" as const,
  source: "default" as const,
  matchingRules: [],
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
        matchingRules: [
          { effect: "always_allow", matchKind: "tool", matchValue: "destination.write" },
        ],
      },
      gateDecision: "allow",
      failClosed: false,
    });
    expect(row.wouldDeny).toBe(false);
    expect(row.matchingRules).toEqual([
      { effect: "always_allow", matchKind: "tool", matchValue: "destination.write" },
    ]);
  });

  it("keeps a missing thread and run as null, not empty string", () => {
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
  });
});
