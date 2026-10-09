import type { TriggerEvent, TriggerFilter } from "@bobbot/contracts";
import { describe, expect, it } from "vitest";
import {
  applyTriggerMappings,
  evaluatePredicate,
  isOverlyBroadTrigger,
  matchesTriggerFilter,
  resolveEventField,
} from "./trigger-filter.js";

function event(payload: Record<string, unknown>, type = "issues"): TriggerEvent {
  return { source: "connector", provider: "github", type, payload };
}

const issueOpened = event({
  action: "opened",
  issue: { title: "Login is broken", labels: ["bug", "auth"] },
  repository: { full_name: "acme/web" },
  sender: { login: "octocat" },
});

describe("resolveEventField", () => {
  it("reads nested payload fields with and without the event prefix", () => {
    expect(resolveEventField(issueOpened, "payload.repository.full_name")).toBe("acme/web");
    expect(resolveEventField(issueOpened, "event.payload.repository.full_name")).toBe("acme/web");
    expect(resolveEventField(issueOpened, "provider")).toBe("github");
  });

  it("returns undefined for a missing path or a non-object hop", () => {
    expect(resolveEventField(issueOpened, "payload.nope.deep")).toBeUndefined();
    expect(resolveEventField(issueOpened, "payload.action.leaf")).toBeUndefined();
  });
});

describe("evaluatePredicate", () => {
  it("compares strings case-insensitively by default", () => {
    expect(
      evaluatePredicate(
        { field: "payload.action", operator: "equals", value: "OPENED", caseSensitive: false },
        issueOpened,
      ),
    ).toBe(true);
    expect(
      evaluatePredicate(
        { field: "payload.action", operator: "equals", value: "OPENED", caseSensitive: true },
        issueOpened,
      ),
    ).toBe(false);
  });

  it("matches membership on an array field for contains and oneOf", () => {
    expect(
      evaluatePredicate(
        { field: "payload.issue.labels", operator: "contains", value: "bug", caseSensitive: false },
        issueOpened,
      ),
    ).toBe(true);
    expect(
      evaluatePredicate(
        {
          field: "payload.issue.labels",
          operator: "oneOf",
          value: ["wontfix", "bug"],
          caseSensitive: false,
        },
        issueOpened,
      ),
    ).toBe(true);
  });

  it("supports startsWith, endsWith, and regex", () => {
    expect(
      evaluatePredicate(
        {
          field: "payload.issue.title",
          operator: "startsWith",
          value: "login",
          caseSensitive: false,
        },
        issueOpened,
      ),
    ).toBe(true);
    expect(
      evaluatePredicate(
        {
          field: "payload.repository.full_name",
          operator: "endsWith",
          value: "/web",
          caseSensitive: false,
        },
        issueOpened,
      ),
    ).toBe(true);
    expect(
      evaluatePredicate(
        {
          field: "payload.issue.title",
          operator: "regex",
          value: "^Login .* broken$",
          caseSensitive: false,
        },
        issueOpened,
      ),
    ).toBe(true);
  });

  it("treats an invalid regex and a missing field as no match", () => {
    expect(
      evaluatePredicate(
        { field: "payload.issue.title", operator: "regex", value: "(", caseSensitive: false },
        issueOpened,
      ),
    ).toBe(false);
    expect(
      evaluatePredicate(
        { field: "payload.missing", operator: "equals", value: "x", caseSensitive: false },
        issueOpened,
      ),
    ).toBe(false);
  });

  it("treats exists as present-and-not-null", () => {
    expect(
      evaluatePredicate(
        { field: "payload.issue.title", operator: "exists", caseSensitive: false },
        issueOpened,
      ),
    ).toBe(true);
    expect(
      evaluatePredicate(
        { field: "payload.missing", operator: "exists", caseSensitive: false },
        issueOpened,
      ),
    ).toBe(false);
  });
  // A count usually arrives as a JSON number, but a connector may send it as a string;
  // both sides are compared as numbers, and a field that is not a number never matches.
  it("compares numbers with gt, lt, gte, and lte", () => {
    const counted = event({ count: 7, label: "7" });
    const compare = (field: string, operator: "gt" | "lt" | "gte" | "lte", value: number) =>
      evaluatePredicate({ field, operator, value, caseSensitive: false }, counted);

    expect(compare("payload.count", "gt", 6)).toBe(true);
    expect(compare("payload.count", "gt", 7)).toBe(false);
    expect(compare("payload.count", "gte", 7)).toBe(true);
    expect(compare("payload.count", "lt", 8)).toBe(true);
    expect(compare("payload.count", "lt", 7)).toBe(false);
    expect(compare("payload.count", "lte", 7)).toBe(true);

    // Only a JSON number on the field compares; a string that looks like one does not,
    // because a string field is text as far as the filter is concerned.
    expect(compare("payload.label", "gte", 7)).toBe(false);
    expect(compare("payload.action", "gt", 0)).toBe(false);
    expect(compare("payload.missing", "lt", 1)).toBe(false);
  });
});

describe("matchesTriggerFilter", () => {
  const narrow: TriggerFilter = {
    predicates: [
      { field: "payload.action", operator: "equals", value: "opened", caseSensitive: false },
      { field: "payload.issue.labels", operator: "contains", value: "bug", caseSensitive: false },
    ],
  };

  it("requires every predicate to pass (AND)", () => {
    expect(matchesTriggerFilter(narrow, issueOpened)).toBe(true);
    expect(
      matchesTriggerFilter(
        {
          predicates: [
            ...narrow.predicates,
            { field: "provider", operator: "equals", value: "slack", caseSensitive: false },
          ],
        },
        issueOpened,
      ),
    ).toBe(false);
  });

  it("never fires on an empty filter", () => {
    const filter: TriggerFilter = { predicates: [] };
    expect(matchesTriggerFilter(filter, issueOpened)).toBe(false);
    expect(isOverlyBroadTrigger(filter)).toBe(true);
  });
});

describe("applyTriggerMappings", () => {
  it("maps event fields onto routine inputs and skips missing ones", () => {
    const inputs = applyTriggerMappings(
      [
        { from: "payload.repository.full_name", to: "repo" },
        { from: "payload.issue.title", to: "title" },
        { from: "payload.missing", to: "absent" },
      ],
      issueOpened,
    );
    expect(inputs).toEqual({ repo: "acme/web", title: "Login is broken" });
    expect("absent" in inputs).toBe(false);
  });

  it("stringifies structured values so a prompt still sees them", () => {
    const inputs = applyTriggerMappings(
      [{ from: "payload.issue.labels", to: "labels" }],
      issueOpened,
    );
    expect(inputs.labels).toBe(JSON.stringify(["bug", "auth"]));
  });
});
