import type { TrustEffect, TrustPolicy } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { effectRisk, isMutating } from "./trust-effects.js";
import {
  assertTrustTransition,
  canAdvanceTrust,
  dryRunAppliedEffects,
  dryRunPreview,
  isDryRunSideEffectFree,
  planRunTrust,
  planTrustPhases,
  TRUST_PHASE_TRANSITIONS,
} from "./trust-runner.js";

function effect(action: TrustEffect["action"]): TrustEffect {
  return { action, target: "x", risk: effectRisk(action) };
}

const defaultPolicy: TrustPolicy = { approvalThreshold: "medium", quietHours: null };

describe("trust transitions", () => {
  it("allows the documented moves and blocks the rest", () => {
    expect(canAdvanceTrust("planned", "dryRun")).toBe(true);
    expect(canAdvanceTrust("dryRun", "approval")).toBe(true);
    expect(canAdvanceTrust("dryRun", "executed")).toBe(true);
    expect(canAdvanceTrust("approval", "executed")).toBe(true);
    expect(canAdvanceTrust("planned", "executed")).toBe(false);
    expect(canAdvanceTrust("approval", "dryRun")).toBe(false);
    expect(canAdvanceTrust("executed", "planned")).toBe(false);
  });

  it("treats executed as terminal", () => {
    expect(TRUST_PHASE_TRANSITIONS.executed).toEqual([]);
  });

  it("throws on an illegal move", () => {
    expect(() => assertTrustTransition("planned", "executed")).toThrow(/Illegal trust transition/);
    expect(() => assertTrustTransition("planned", "dryRun")).not.toThrow();
  });
});

describe("planTrustPhases", () => {
  it("skips approval for a read-only plan", () => {
    expect(planTrustPhases([effect("read"), effect("draft")], defaultPolicy)).toEqual([
      "planned",
      "dryRun",
      "executed",
    ]);
  });

  it("inserts approval when an effect reaches the line", () => {
    expect(planTrustPhases([effect("update")], defaultPolicy)).toEqual([
      "planned",
      "dryRun",
      "approval",
      "executed",
    ]);
    expect(planTrustPhases([effect("delete")], defaultPolicy)).toEqual([
      "planned",
      "dryRun",
      "approval",
      "executed",
    ]);
  });

  it("honors a raised threshold", () => {
    const strict: TrustPolicy = { approvalThreshold: "high", quietHours: null };
    expect(planTrustPhases([effect("update")], strict)).toEqual(["planned", "dryRun", "executed"]);
    expect(planTrustPhases([effect("delete")], strict)).toEqual([
      "planned",
      "dryRun",
      "approval",
      "executed",
    ]);
  });
});

describe("dry run conformance", () => {
  const plan = [
    effect("read"),
    effect("list"),
    effect("draft"),
    effect("create"),
    effect("delete"),
  ];

  it("keeps mutating effects for display but marks them unapplied", () => {
    const preview = dryRunPreview(plan);
    expect(preview).toHaveLength(plan.length);
    expect(preview.filter((entry) => entry.applied).map((entry) => entry.effect.action)).toEqual([
      "read",
      "list",
      "draft",
    ]);
  });

  it("applies nothing that mutates the outside world", () => {
    const applied = dryRunAppliedEffects(plan);
    expect(applied.map((entry) => entry.action)).toEqual(["read", "list", "draft"]);
    for (const entry of applied) {
      expect(isMutating(entry.action)).toBe(false);
    }
  });

  it("holds for a plan that is entirely mutating", () => {
    const writes = [effect("create"), effect("update"), effect("publish")];
    expect(isDryRunSideEffectFree(writes)).toBe(true);
    expect(dryRunAppliedEffects(writes)).toEqual([]);
  });
});

describe("planRunTrust", () => {
  const night: TrustPolicy = {
    approvalThreshold: "medium",
    quietHours: { start: "22:00", end: "07:00", timezone: "UTC" },
  };
  const midnight = new Date("2026-10-10T23:00:00Z");
  const noon = new Date("2026-10-10T12:00:00Z");

  it("starts planned when no quiet window is set", () => {
    expect(planRunTrust([effect("delete")], defaultPolicy, midnight)).toEqual({
      phase: "planned",
      paused: false,
      resumeAt: null,
    });
  });

  it("pauses a consequential plan inside the window", () => {
    const result = planRunTrust([effect("update")], night, midnight);
    expect(result.phase).toBe("paused");
    expect(result.paused).toBe(true);
    expect(result.resumeAt).not.toBeNull();
  });

  it("never holds a read-only plan", () => {
    expect(planRunTrust([effect("read")], night, midnight)).toEqual({
      phase: "planned",
      paused: false,
      resumeAt: null,
    });
  });

  it("runs once the window closes", () => {
    expect(planRunTrust([effect("delete")], night, noon)).toEqual({
      phase: "planned",
      paused: false,
      resumeAt: null,
    });
  });
});
