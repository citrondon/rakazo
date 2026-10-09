import type { Trigger, TriggerEvent } from "@bobbot/contracts";
import { describe, expect, it } from "vitest";
import { selectTriggeredRoutines, type TriggerCandidate } from "../src/trigger-engine";

const mockCandidates: TriggerCandidate[] = [
  { routineId: "grok-coder", name: "GrokCoder", prompt: "coder" },
  { routineId: "support-desk", name: "SupportDesk", prompt: "support" },
  { routineId: "cloud-spend", name: "CloudSpend", prompt: "spend" },
];

function trigger(
  routineId: string,
  field: string,
  operator: "contains" | "gte",
  value: string | number,
  enabled = true,
): Trigger {
  return {
    id: `trigger-${routineId}-${field}`,
    routineId,
    botId: "bot-fixture",
    source: "webhook",
    provider: "fixture",
    eventType: "thread.message.created",
    filter: { predicates: [{ field, operator, value, caseSensitive: false }] },
    mappings: [],
    enabled,
    createdAt: "2026-10-06T06:00:00.000Z",
    updatedAt: "2026-10-06T06:00:00.000Z",
  };
}

const mockTriggers: Trigger[] = [
  trigger("grok-coder", "event.payload.text", "contains", "code"),
  trigger("support-desk", "event.payload.text", "contains", "ticket"),
  trigger("cloud-spend", "event.payload.errorRate", "gte", 0.05),
  trigger("grok-coder", "event.payload.text", "contains", "old", false),
];

function messageEvent(text: string): TriggerEvent {
  return {
    source: "webhook",
    provider: "fixture",
    type: "thread.message.created",
    payload: { text },
  };
}

describe("Autonomous Workflow Scenarios", () => {
  it("should simulate a code request and trigger GrokCoder", () => {
    const triggered = selectTriggeredRoutines(
      mockCandidates,
      mockTriggers,
      messageEvent("Bitte schreibe den code für das Login-Formular"),
    );
    expect(triggered.map((entry) => entry.name)).toContain("GrokCoder");
  });

  it("should simulate a ticket and trigger SupportDesk", () => {
    const triggered = selectTriggeredRoutines(
      mockCandidates,
      mockTriggers,
      messageEvent("Neues Support-Ticket: Fehler"),
    );
    expect(triggered.some((entry) => entry.name === "SupportDesk")).toBe(true);
  });

  it("should handle disabled triggers without crashing", () => {
    const triggered = selectTriggeredRoutines(
      mockCandidates,
      mockTriggers,
      messageEvent("irgendein text"),
    );
    expect(triggered).toEqual([]);
  });
});
