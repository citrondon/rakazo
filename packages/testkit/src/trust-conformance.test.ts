import type {
  Trigger,
  TriggerEvent,
  TrustEffect,
  TrustEffectAction,
  TrustPolicy,
} from "@bobbot/contracts";
import {
  dryRunAppliedEffects,
  dryRunPreview,
  effectRisk,
  isDryRunSideEffectFree,
  isMutating,
  MUTATING_ACTIONS,
  matchesTriggerFilter,
  planQuietHours,
  planTrustPhases,
  policyRequiresApproval,
  selectTriggeredRoutines,
  TRUST_PHASE_TRANSITIONS,
  withinQuietHours,
} from "@bobbot/core";
import { describe, expect, it } from "vitest";

/**
 * Deterministic, offline conformance for the trust kit: the invariants that must hold for any
 * plan, filter, or quiet window. No provider, computer, or network is involved, so a regression
 * here is a real safety regression rather than a flaky environment.
 */

const ALL_ACTIONS: TrustEffectAction[] = [
  "read",
  "list",
  "draft",
  "create",
  "update",
  "notify",
  "delete",
  "transfer",
  "publish",
];

function effect(action: TrustEffectAction): TrustEffect {
  return { action, target: "target", risk: effectRisk(action) };
}

const defaultPolicy: TrustPolicy = { approvalThreshold: "medium", quietHours: null };

describe("dry-run conformance", () => {
  it("applies only read/list/draft and expands to exactly the non-mutating actions", () => {
    const plan = ALL_ACTIONS.map(effect);
    const applied = dryRunAppliedEffects(plan).map((entry) => entry.action);
    expect(applied).toEqual(["read", "list", "draft"]);
    for (const entry of plan) {
      expect(isMutating(entry.action)).toBe(MUTATING_ACTIONS.has(entry.action));
    }
  });

  it("keeps every mutating effect for display but leaves it unapplied", () => {
    const preview = dryRunPreview(ALL_ACTIONS.map(effect));
    expect(preview).toHaveLength(ALL_ACTIONS.length);
    for (const entry of preview) {
      expect(entry.applied).toBe(!isMutating(entry.effect.action));
    }
    expect(isDryRunSideEffectFree(ALL_ACTIONS.map(effect))).toBe(true);
  });
});

describe("approval conformance", () => {
  it("asks for every mutating action at the default threshold", () => {
    for (const action of ALL_ACTIONS) {
      const required = policyRequiresApproval([effect(action)], defaultPolicy);
      expect(required).toBe(isMutating(action));
    }
  });

  it("places approval between dry run and execution exactly when required", () => {
    for (const action of ALL_ACTIONS) {
      const phases = planTrustPhases([effect(action)], defaultPolicy);
      expect(phases.slice(0, 2)).toEqual(["planned", "dryRun"]);
      expect(phases.at(-1)).toBe("executed");
      expect(phases.includes("approval")).toBe(isMutating(action));
    }
  });

  it("treats executed as terminal and never skips the dry run", () => {
    expect(TRUST_PHASE_TRANSITIONS.executed).toEqual([]);
    expect(TRUST_PHASE_TRANSITIONS.planned).not.toContain("executed");
  });
});

describe("quiet-hours conformance", () => {
  const night: TrustPolicy = {
    approvalThreshold: "medium",
    quietHours: { start: "22:00", end: "07:00", timezone: "UTC" },
  };

  it("wraps a window that crosses midnight", () => {
    expect(withinQuietHours(new Date("2026-10-10T23:30:00Z"), night.quietHours!)).toBe(true);
    expect(withinQuietHours(new Date("2026-10-10T03:00:00Z"), night.quietHours!)).toBe(true);
    expect(withinQuietHours(new Date("2026-10-10T12:00:00Z"), night.quietHours!)).toBe(false);
  });

  it("pauses only the plans that would otherwise ask for approval", () => {
    const at = new Date("2026-10-10T23:00:00Z");
    expect(planQuietHours([effect("read"), effect("draft")], night, at)).toBe("run");
    expect(planQuietHours([effect("update")], night, at)).toBe("pause");
    expect(planQuietHours([effect("delete")], night, at)).toBe("pause");
  });
});

describe("trigger conformance", () => {
  const event: TriggerEvent = {
    source: "connector",
    provider: "github",
    type: "issues",
    payload: { action: "opened", repository: { full_name: "acme/web" } },
  };

  function trigger(overrides: Partial<Trigger> = {}): Trigger {
    return {
      id: "t1",
      routineId: "r1",
      botId: "b1",
      source: "connector",
      provider: "github",
      eventType: "issues",
      filter: {
        predicates: [
          { field: "payload.action", operator: "equals", value: "opened", caseSensitive: false },
        ],
      },
      mappings: [],
      enabled: true,
      createdAt: "2026-10-10T00:00:00.000Z",
      updatedAt: "2026-10-10T00:00:00.000Z",
      ...overrides,
    };
  }

  it("never fires on an empty filter", () => {
    expect(matchesTriggerFilter({ predicates: [] }, event)).toBe(false);
  });

  it("does not broaden: a routine with an unmatched trigger is dropped", () => {
    const candidates = [{ routineId: "r1", name: "Bug triage", prompt: "Triage." }];
    const selected = selectTriggeredRoutines(
      candidates,
      [
        trigger({
          filter: {
            predicates: [
              {
                field: "payload.action",
                operator: "equals",
                value: "closed",
                caseSensitive: false,
              },
            ],
          },
        }),
      ],
      event,
    );
    expect(selected).toEqual([]);
  });

  it("leaves a routine with no triggers on its legacy behavior", () => {
    const candidates = [{ routineId: "r2", name: "Weekly digest", prompt: "Summarise." }];
    expect(selectTriggeredRoutines(candidates, [trigger()], event)).toEqual([
      { name: "Weekly digest", prompt: "Summarise." },
    ]);
  });
});
