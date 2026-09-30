import type { Trigger, TriggerEvent } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { formatRoutineInputs, selectTriggeredRoutines } from "./trigger-engine.js";

function event(payload: Record<string, unknown>, type = "issues"): TriggerEvent {
  return { source: "connector", provider: "github", type, payload };
}

function trigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: "trg-1",
    routineId: "routine-1",
    botId: "bot-1",
    source: "connector",
    provider: "github",
    eventType: "issues",
    filter: {
      predicates: [
        { field: "payload.action", operator: "equals", value: "opened", caseSensitive: false },
      ],
    },
    mappings: [{ from: "payload.repository.full_name", to: "repo" }],
    enabled: true,
    createdAt: "2026-10-10T09:00:00.000Z",
    updatedAt: "2026-10-10T09:00:00.000Z",
    ...overrides,
  };
}

const opened = event({
  action: "opened",
  repository: { full_name: "acme/web" },
  issue: { title: "Login is broken" },
});
const closed = event({ action: "closed", repository: { full_name: "acme/web" } });

describe("formatRoutineInputs", () => {
  it("returns an empty string when there are no inputs", () => {
    expect(formatRoutineInputs({})).toBe("");
  });

  it("lists the mapped inputs under a header", () => {
    expect(formatRoutineInputs({ repo: "acme/web", title: "Login is broken" })).toBe(
      ["Routine inputs:", "- repo: acme/web", "- title: Login is broken"].join("\n"),
    );
  });
});

describe("selectTriggeredRoutines", () => {
  const candidates = [
    { routineId: "routine-1", name: "Bug triage", prompt: "Triage the bug." },
    { routineId: "routine-2", name: "Weekly digest", prompt: "Summarise the week." },
  ];

  it("keeps a routine with no triggers on its legacy behavior", () => {
    const selected = selectTriggeredRoutines(candidates, [], opened);
    expect(selected).toEqual([
      { name: "Bug triage", prompt: "Triage the bug." },
      { name: "Weekly digest", prompt: "Summarise the week." },
    ]);
  });

  it("keeps a routine whose trigger matches and folds in the mapped inputs", () => {
    const selected = selectTriggeredRoutines([candidates[0]!], [trigger()], opened);
    expect(selected).toHaveLength(1);
    expect(selected[0]!.prompt).toBe("Triage the bug.\n\nRoutine inputs:\n- repo: acme/web");
  });

  it("drops a routine whose triggers all fail the filter", () => {
    const selected = selectTriggeredRoutines([candidates[0]!], [trigger()], closed);
    expect(selected).toEqual([]);
  });

  it("ignores a disabled trigger, leaving the routine on its legacy behavior", () => {
    const selected = selectTriggeredRoutines(
      [candidates[0]!],
      [trigger({ enabled: false })],
      closed,
    );
    expect(selected).toEqual([{ name: "Bug triage", prompt: "Triage the bug." }]);
  });

  it("fires when any one of a routine's triggers matches, merging their inputs", () => {
    const triggers = [
      trigger({
        id: "trg-a",
        filter: {
          predicates: [
            { field: "payload.action", operator: "equals", value: "closed", caseSensitive: false },
          ],
        },
        mappings: [],
      }),
      trigger({ id: "trg-b" }),
    ];
    const selected = selectTriggeredRoutines([candidates[0]!], triggers, opened);
    expect(selected).toHaveLength(1);
    expect(selected[0]!.prompt).toBe("Triage the bug.\n\nRoutine inputs:\n- repo: acme/web");
  });
});
