import { describe, expect, it } from "vitest";
import {
  CreateTriggerInput,
  QuietHoursSchema,
  TrustEffectSchema,
  TrustPolicySchema,
  TrustPolicyViewSchema,
  UpdateTriggerInput,
} from "./triggers.js";

describe("CreateTriggerInput", () => {
  it("accepts a narrow trigger with a predicate and a mapping", () => {
    const parsed = CreateTriggerInput.parse({
      routineId: "routine-1",
      source: "connector",
      provider: "github",
      eventType: "issues",
      filter: {
        predicates: [
          { field: "payload.action", operator: "equals", value: "opened" },
          { field: "payload.issue.labels", operator: "contains", value: "bug" },
        ],
      },
      mappings: [{ from: "payload.repository.full_name", to: "repo" }],
    });
    expect(parsed.enabled).toBe(true);
    expect(parsed.eventType).toBe("issues");
    expect(parsed.filter.predicates).toHaveLength(2);
    expect(parsed.filter.predicates[0]?.caseSensitive).toBe(false);
  });

  it("rejects a broad listener with no predicates", () => {
    const result = CreateTriggerInput.safeParse({
      routineId: "routine-1",
      source: "connector",
      provider: "github",
      filter: { predicates: [] },
    });
    expect(result.success).toBe(false);
  });

  it("defaults eventType to null and mappings to empty", () => {
    const parsed = CreateTriggerInput.parse({
      routineId: "routine-1",
      source: "webhook",
      provider: "webhook",
      filter: { predicates: [{ field: "payload.kind", operator: "exists" }] },
    });
    expect(parsed.eventType).toBeNull();
    expect(parsed.mappings).toEqual([]);
  });
});

describe("TriggerPredicate shape", () => {
  it("rejects a value on exists and a bare string on oneOf", () => {
    const withValue = CreateTriggerInput.safeParse({
      routineId: "r",
      source: "connector",
      provider: "slack",
      filter: { predicates: [{ field: "payload.text", operator: "exists", value: "x" }] },
    });
    expect(withValue.success).toBe(false);

    const badOneOf = CreateTriggerInput.safeParse({
      routineId: "r",
      source: "connector",
      provider: "slack",
      filter: { predicates: [{ field: "payload.text", operator: "oneOf", value: "x" }] },
    });
    expect(badOneOf.success).toBe(false);
  });

  // A threshold a person types arrives as a string; the number branch accepts both so a
  // numeric predicate can be saved from the panel without the caller coercing first.
  it("takes a number or a numeric string for the comparison operators", () => {
    for (const operator of ["gt", "lt", "gte", "lte"] as const) {
      const fromNumber = CreateTriggerInput.safeParse({
        routineId: "r",
        source: "connector",
        provider: "slack",
        filter: { predicates: [{ field: "payload.count", operator, value: 3 }] },
      });
      expect(fromNumber.success, operator).toBe(true);

      const fromString = CreateTriggerInput.safeParse({
        routineId: "r",
        source: "connector",
        provider: "slack",
        filter: { predicates: [{ field: "payload.count", operator, value: "3.5" }] },
      });
      expect(fromString.success, operator).toBe(true);

      const fromWord = CreateTriggerInput.safeParse({
        routineId: "r",
        source: "connector",
        provider: "slack",
        filter: { predicates: [{ field: "payload.count", operator, value: "many" }] },
      });
      expect(fromWord.success, operator).toBe(false);
    }
  });

  it("requires a non-empty list for oneOf", () => {
    const result = CreateTriggerInput.safeParse({
      routineId: "r",
      source: "connector",
      provider: "slack",
      filter: { predicates: [{ field: "payload.text", operator: "oneOf", value: [] }] },
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateTriggerInput", () => {
  it("requires at least one field besides the id", () => {
    expect(UpdateTriggerInput.safeParse({ triggerId: "t1" }).success).toBe(false);
    expect(UpdateTriggerInput.safeParse({ triggerId: "t1", enabled: false }).success).toBe(true);
  });

  it("still rejects a broad filter", () => {
    const result = UpdateTriggerInput.safeParse({
      triggerId: "t1",
      filter: { predicates: [] },
    });
    expect(result.success).toBe(false);
  });
});

describe("TrustPolicySchema", () => {
  it("defaults to a medium approval threshold, no quiet hours, and no space limit", () => {
    const parsed = TrustPolicySchema.parse({});
    expect(parsed.approvalThreshold).toBe("medium");
    expect(parsed.quietHours).toBeNull();
    expect(parsed.maxToolCallsPerTurn).toBeNull();
  });

  it("keeps a stored 0 as unlimited and an explicit null as inherit", () => {
    expect(TrustPolicySchema.parse({ maxToolCallsPerTurn: 0 }).maxToolCallsPerTurn).toBe(0);
    expect(TrustPolicySchema.parse({ maxToolCallsPerTurn: null }).maxToolCallsPerTurn).toBeNull();
    expect(TrustPolicySchema.parse({ maxToolCallsPerTurn: 200 }).maxToolCallsPerTurn).toBe(200);
  });

  it("rejects a limit above the ceiling", () => {
    expect(TrustPolicySchema.safeParse({ maxToolCallsPerTurn: 100_001 }).success).toBe(false);
  });

  it("accepts a quiet window and rejects a malformed clock", () => {
    expect(QuietHoursSchema.safeParse({ start: "22:00", end: "07:00" }).success).toBe(true);
    expect(QuietHoursSchema.safeParse({ start: "25:00", end: "07:00" }).success).toBe(false);
    expect(QuietHoursSchema.parse({ start: "08:30", end: "09:00" }).timezone).toBe("UTC");
  });
});

describe("TrustPolicyViewSchema", () => {
  it("carries the deployment default next to the stored value", () => {
    expect(TrustPolicyViewSchema.parse({ maxToolCallsPerTurnDefault: 10 })).toEqual({
      approvalThreshold: "medium",
      quietHours: null,
      maxToolCallsPerTurn: null,
      maxToolCallsPerTurnDefault: 10,
    });
  });

  it("requires the deployment default", () => {
    expect(TrustPolicyViewSchema.safeParse({}).success).toBe(false);
  });
});

describe("TrustEffectSchema", () => {
  it("keeps the action, target, and risk tier", () => {
    const parsed = TrustEffectSchema.parse({
      action: "delete",
      target: "prod.table",
      risk: "high",
    });
    expect(parsed.risk).toBe("high");
  });

  it("rejects an unknown action", () => {
    expect(
      TrustEffectSchema.safeParse({ action: "explode", target: "x", risk: "high" }).success,
    ).toBe(false);
  });
});
