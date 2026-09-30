import type { TrustEffect, TrustPolicy } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  EFFECT_RISK,
  effectRisk,
  highestRisk,
  isMutating,
  minutesOfDay,
  parseClockMinutes,
  planQuietHours,
  policyRequiresApproval,
  requiresApproval,
  riskRank,
  withinQuietHours,
} from "./trust-effects.js";

function effect(action: TrustEffect["action"]): TrustEffect {
  return { action, target: "x", risk: effectRisk(action) };
}

const defaultPolicy: TrustPolicy = { approvalThreshold: "medium", quietHours: null };

describe("risk tiers", () => {
  it("classifies every action into its tier", () => {
    expect(effectRisk("read")).toBe("low");
    expect(effectRisk("draft")).toBe("low");
    expect(effectRisk("create")).toBe("medium");
    expect(effectRisk("notify")).toBe("medium");
    expect(effectRisk("delete")).toBe("high");
    expect(effectRisk("transfer")).toBe("high");
    expect(effectRisk("publish")).toBe("high");
    expect(Object.keys(EFFECT_RISK)).toHaveLength(9);
  });

  it("marks only write tiers as mutating", () => {
    expect(isMutating("draft")).toBe(false);
    expect(isMutating("read")).toBe(false);
    expect(isMutating("create")).toBe(true);
    expect(isMutating("publish")).toBe(true);
  });

  it("orders risk tiers", () => {
    expect(riskRank("low")).toBeLessThan(riskRank("medium"));
    expect(riskRank("medium")).toBeLessThan(riskRank("high"));
  });
});

describe("highestRisk", () => {
  it("returns low for an empty plan and the worst tier otherwise", () => {
    expect(highestRisk([])).toBe("low");
    expect(highestRisk([effect("read"), effect("draft")])).toBe("low");
    expect(highestRisk([effect("read"), effect("update"), effect("draft")])).toBe("medium");
    expect(highestRisk([effect("create"), effect("delete")])).toBe("high");
  });
});

describe("requiresApproval", () => {
  it("asks at or above the threshold", () => {
    expect(requiresApproval("low", defaultPolicy)).toBe(false);
    expect(requiresApproval("medium", defaultPolicy)).toBe(true);
    expect(requiresApproval("high", defaultPolicy)).toBe(true);
  });

  it("can be raised to ask only on the top tier", () => {
    const strict: TrustPolicy = { approvalThreshold: "high", quietHours: null };
    expect(requiresApproval("medium", strict)).toBe(false);
    expect(requiresApproval("high", strict)).toBe(true);
  });

  it("checks the whole plan, not just the first effect", () => {
    expect(policyRequiresApproval([effect("read"), effect("transfer")], defaultPolicy)).toBe(true);
    expect(policyRequiresApproval([effect("read"), effect("draft")], defaultPolicy)).toBe(false);
  });
});

describe("quiet hours", () => {
  it("parses HH:MM and rejects a malformed clock", () => {
    expect(parseClockMinutes("00:00")).toBe(0);
    expect(parseClockMinutes("22:30")).toBe(22 * 60 + 30);
    expect(parseClockMinutes("24:00")).toBeNull();
    expect(parseClockMinutes("9:00")).toBeNull();
  });

  it("reads the local wall clock in the window's timezone", () => {
    const at = new Date("2026-10-10T22:30:00.000Z");
    expect(minutesOfDay(at, "UTC")).toBe(22 * 60 + 30);
    // 2026-10-10 is inside US daylight time (UTC-4).
    expect(minutesOfDay(at, "America/New_York")).toBe(18 * 60 + 30);
    expect(minutesOfDay(at, "Not/AZone")).toBe(22 * 60 + 30);
  });

  it("handles a window inside one day and one that wraps midnight", () => {
    const lunch = { start: "08:00", end: "09:00", timezone: "UTC" };
    expect(withinQuietHours(new Date("2026-10-10T08:30:00Z"), lunch)).toBe(true);
    expect(withinQuietHours(new Date("2026-10-10T09:00:00Z"), lunch)).toBe(false);

    const night = { start: "22:00", end: "07:00", timezone: "UTC" };
    expect(withinQuietHours(new Date("2026-10-10T23:00:00Z"), night)).toBe(true);
    expect(withinQuietHours(new Date("2026-10-10T03:00:00Z"), night)).toBe(true);
    expect(withinQuietHours(new Date("2026-10-10T12:00:00Z"), night)).toBe(false);
  });
});

describe("planQuietHours", () => {
  const night: TrustPolicy = {
    approvalThreshold: "medium",
    quietHours: { start: "22:00", end: "07:00", timezone: "UTC" },
  };
  const midnight = new Date("2026-10-10T23:00:00Z");
  const noon = new Date("2026-10-10T12:00:00Z");

  it("never pauses when no window is configured", () => {
    expect(planQuietHours([effect("delete")], defaultPolicy, midnight)).toBe("run");
  });

  it("pauses only effects that reach the approval line", () => {
    expect(planQuietHours([effect("read"), effect("draft")], night, midnight)).toBe("run");
    expect(planQuietHours([effect("update")], night, midnight)).toBe("pause");
    expect(planQuietHours([effect("read"), effect("delete")], night, midnight)).toBe("pause");
  });

  it("runs again once the window closes", () => {
    expect(planQuietHours([effect("delete")], night, noon)).toBe("run");
  });
});
