import { describe, expect, it } from "vitest";
import {
  CreateTriggerInput,
  QuietHoursSchema,
  TrustEffectSchema,
  TrustPolicySchema,
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
  it("defaults to a medium approval threshold and no quiet hours", () => {
    const parsed = TrustPolicySchema.parse({});
    expect(parsed.approvalThreshold).toBe("medium");
    expect(parsed.quietHours).toBeNull();
  });

  it("accepts a quiet window and rejects a malformed clock", () => {
    expect(QuietHoursSchema.safeParse({ start: "22:00", end: "07:00" }).success).toBe(true);
    expect(QuietHoursSchema.safeParse({ start: "25:00", end: "07:00" }).success).toBe(false);
    expect(QuietHoursSchema.parse({ start: "08:30", end: "09:00" }).timezone).toBe("UTC");
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
