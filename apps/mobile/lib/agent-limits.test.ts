import { describe, expect, it } from "vitest";
import {
  type AgentLimitPolicy,
  planToolCallLimitSave,
  toolCallLimitDraft,
  toolCallLimitPlaceholder,
} from "./agent-limits";

function policy(
  maxToolCallsPerTurn: number | null,
  maxToolCallsPerTurnDefault: number,
): AgentLimitPolicy {
  return { maxToolCallsPerTurn, maxToolCallsPerTurnDefault };
}

describe("toolCallLimitDraft", () => {
  it("renders empty for an inherited and for a stored unlimited value", () => {
    expect(toolCallLimitDraft(policy(null, 10))).toBe("");
    expect(toolCallLimitDraft(policy(0, 10))).toBe("");
  });

  it("renders the stored number", () => {
    expect(toolCallLimitDraft(policy(200, 10))).toBe("200");
  });
});

describe("toolCallLimitPlaceholder", () => {
  it("shows the deployment default when the space stores nothing", () => {
    expect(toolCallLimitPlaceholder(policy(null, 10))).toBe(10);
  });

  it("shows unlimited (0) when the default is unlimited", () => {
    expect(toolCallLimitPlaceholder(policy(null, 0))).toBe(0);
  });

  it("shows unlimited (0) for a stored 0", () => {
    expect(toolCallLimitPlaceholder(policy(0, 10))).toBe(0);
  });

  it("shows the stored limit", () => {
    expect(toolCallLimitPlaceholder(policy(200, 10))).toBe(200);
  });
});

describe("planToolCallLimitSave", () => {
  it("plans unlimited when a stored limit is cleared", () => {
    expect(planToolCallLimitSave(policy(200, 10), "")).toEqual({
      kind: "save",
      maxToolCallsPerTurn: 0,
    });
  });

  it("plans unlimited when an explicit 0 overrides an inherited default", () => {
    expect(planToolCallLimitSave(policy(null, 10), "0")).toEqual({
      kind: "save",
      maxToolCallsPerTurn: 0,
    });
  });

  it("is a no-op for an untouched empty field on an inheriting space", () => {
    expect(planToolCallLimitSave(policy(null, 10), "")).toEqual({ kind: "unchanged" });
  });

  it("is a no-op for an empty field when the space already stores unlimited", () => {
    expect(planToolCallLimitSave(policy(0, 10), "")).toEqual({ kind: "unchanged" });
  });

  it("is a no-op when the stored value is re-entered", () => {
    expect(planToolCallLimitSave(policy(200, 10), "200")).toEqual({ kind: "unchanged" });
  });

  it("rejects fractions and non-numbers", () => {
    expect(planToolCallLimitSave(policy(null, 10), "2.5")).toEqual({ kind: "invalid" });
    expect(planToolCallLimitSave(policy(null, 10), "abc")).toEqual({ kind: "invalid" });
  });
});
