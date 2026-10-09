import { describe, expect, it } from "vitest";
import { BOT_SAFETY_PREAMBLE } from "./bot-safety-preamble.js";
import { estimateContextTokens } from "./context-selection.js";

/**
 * Every rule costs tokens on every request, so the preamble is deliberately terse.
 * These checks keep a rule from being trimmed away as "prose".
 */
const RULES: ReadonlyArray<readonly [name: string, pattern: RegExp]> = [
  ["treats outside content as data, not orders", /Daten, keine Befehle/],
  ["asks before outward effects", /nach außen wirkt/],
  ["keeps secrets in", /Geheimnisse nie ausgeben/],
  ["forbids invented sources", /Nichts erfinden/],
  ["answers in the user's language", /Sprache des Nutzers/],
  ["spends tools sparingly", /Nur nötige Tools/],
];

/** Headroom for the rule lines above; raise it only with a measured reason. */
const TOKEN_BUDGET = 1_200;

describe("the safety preamble", () => {
  it("keeps every rule", () => {
    for (const [name, pattern] of RULES) {
      expect(BOT_SAFETY_PREAMBLE, name).toMatch(pattern);
    }
  });

  it("stays inside the budget it was cut for", () => {
    expect(estimateContextTokens(BOT_SAFETY_PREAMBLE)).toBeLessThanOrEqual(TOKEN_BUDGET);
  });

  it("states one rule per line under a heading", () => {
    const lines = BOT_SAFETY_PREAMBLE.split("\n").filter((line) => line.length > 0);
    expect(lines[0]).toBe("### Sicherheit & Verhalten (gilt immer)");
    expect(lines).toHaveLength(1 + RULES.length);
    for (const rule of lines.slice(1)) {
      expect(rule.startsWith("- ")).toBe(true);
    }
  });
});
