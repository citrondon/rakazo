import { parseSkillMd } from "@bobbot/core";
import { describe, expect, it } from "vitest";
import { BUILTIN_AGENT_SKILLS } from "./builtin-skills.js";
import { builtinAgentTools } from "./builtin-tools.js";

/** A backticked word that is a single lowercase snake_case token is meant to be a tool name. */
const TOOL_TOKEN = /^[a-z][a-z0-9]*_[a-z0-9_]*$/;

function codeSpans(body: string): string[] {
  return [...body.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!);
}

describe("builtin agent skills", () => {
  it("ships the catalog jobs as valid, read-only SKILL.md recipes", () => {
    const names = BUILTIN_AGENT_SKILLS.map((skill) => skill.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(10);
    for (const skill of BUILTIN_AGENT_SKILLS) {
      const parsed = parseSkillMd(skill.content);
      expect("error" in parsed).toBe(false);
      expect(parsed).toMatchObject({ name: skill.name, description: skill.description });
      // The / picker and the injected catalog both truncate, so keep the hook short.
      expect(skill.description.length).toBeLessThanOrEqual(72);
    }
  });

  it("covers the jobs a team expects from the first / keystroke", () => {
    const names = BUILTIN_AGENT_SKILLS.map((skill) => skill.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Daily Brief",
        "Inbox Triage",
        "Meeting Notes",
        "Focus Defender",
        "Competitor Watch",
        "Newsletter Desk",
        "Changelog Bot",
        "Issue Drafter",
        "Docs Writer",
        "Query Helper",
      ]),
    );
  });

  it("names only tools the runtime actually offers", () => {
    const toolNames = new Set(builtinAgentTools.map((tool) => tool.name));
    for (const skill of BUILTIN_AGENT_SKILLS) {
      const parsed = parseSkillMd(skill.content);
      if ("error" in parsed) throw new Error(`Invalid SKILL.md for ${skill.name}`);
      const referenced = codeSpans(parsed.body).filter((span) => TOOL_TOKEN.test(span));
      for (const token of referenced) {
        expect(toolNames.has(token)).toBe(true);
      }
    }
  });

  it("stays portable: no host paths, no scripts that are not shipped", () => {
    for (const skill of BUILTIN_AGENT_SKILLS) {
      const parsed = parseSkillMd(skill.content);
      if ("error" in parsed) throw new Error(`Invalid SKILL.md for ${skill.name}`);
      expect(parsed.body).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\/rakazo\/|shared\/tools\//);
      expect(parsed.body).not.toMatch(/python[0-9]?\s+\//);
    }
  });
});
