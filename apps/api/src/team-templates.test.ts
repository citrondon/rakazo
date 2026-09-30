import { describe, expect, it } from "vitest";
import { findTeamTemplate, listTeamTemplates, teamPresetManifestPath } from "./team-templates.js";

describe("shipped team templates", () => {
  const templates = listTeamTemplates();

  it("parses every template and keeps ids unique", () => {
    expect(templates.length).toBeGreaterThan(0);
    expect(new Set(templates.map((template) => template.id)).size).toBe(templates.length);
  });

  it("keeps a team small and gives every member its own preset", () => {
    for (const template of templates) {
      expect(template.members.length, template.id).toBeGreaterThanOrEqual(2);
      expect(template.members.length, template.id).toBeLessThanOrEqual(4);
      expect(new Set(template.members.map((member) => member.preset)).size, template.id).toBe(
        template.members.length,
      );
    }
  });

  // A template that names a preset the library does not ship fails halfway through
  // creation, which is worse than not offering the team at all.
  it("only names presets the library ships", () => {
    for (const template of templates) {
      for (const member of template.members) {
        expect(
          teamPresetManifestPath(member.preset),
          `${template.id}/${member.preset}`,
        ).toBeDefined();
      }
    }
  });

  it("finds a template by id and ignores an unknown one", () => {
    const first = templates[0];
    if (!first) throw new Error("no team templates shipped");
    expect(findTeamTemplate(first.id)).toEqual(first);
    expect(findTeamTemplate("does-not-exist")).toBeUndefined();
  });

  it("keeps preset lookup inside the library directory", () => {
    expect(teamPresetManifestPath("../package")).toBeUndefined();
    expect(teamPresetManifestPath("executive-chief")).toBeDefined();
  });
});
