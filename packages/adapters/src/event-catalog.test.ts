import { describe, expect, it } from "vitest";
import {
  EVENT_CATALOG,
  eventDefinitionId,
  findEventDefinition,
  listEventDefinitions,
} from "./event-catalog.js";

describe("event catalog", () => {
  it("gives every definition a stable provider:type id", () => {
    const ids = EVENT_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of EVENT_CATALOG) {
      expect(entry.id).toBe(eventDefinitionId(entry.provider, entry.type));
    }
  });

  it("names at least one field per definition so rules stay narrow", () => {
    for (const entry of EVENT_CATALOG) {
      expect(entry.fields.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it("covers the providers the routine editor already lists", () => {
    const providers = new Set(EVENT_CATALOG.map((entry) => entry.provider));
    for (const provider of [
      "github",
      "slack",
      "linear",
      "sentry",
      "pagerduty",
      "teams",
      "webhook",
    ]) {
      expect(providers.has(provider)).toBe(true);
    }
  });

  it("finds by id and filters by provider", () => {
    expect(findEventDefinition("github:issues")?.label).toBe("GitHub issue");
    expect(findEventDefinition("nope:nope")).toBeUndefined();
    expect(listEventDefinitions("github").map((entry) => entry.type)).toEqual([
      "issues",
      "pull_request",
    ]);
    expect(listEventDefinitions()).toHaveLength(EVENT_CATALOG.length);
  });
});
