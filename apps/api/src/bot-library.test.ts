import { describe, expect, it } from "vitest";
import {
  findIdentity,
  findTeamTemplate,
  listIdentities,
  listTeamTemplates,
  teamPresetManifestPath,
} from "./bot-library.js";

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

describe("shipped identities", () => {
  const identities = listIdentities();

  it("parses every identity and keeps ids unique", () => {
    expect(identities.length).toBeGreaterThan(0);
    expect(new Set(identities.map((identity) => identity.id)).size).toBe(identities.length);
  });

  // The first screen sends a new space from an identity straight into team
  // creation, so an identity pointing at a team nobody ships leads nowhere.
  it("names a team the library ships", () => {
    for (const identity of identities) {
      expect(findTeamTemplate(identity.team), `${identity.id} -> ${identity.team}`).toBeDefined();
    }
  });

  it("finds an identity by id and ignores an unknown one", () => {
    const first = identities[0];
    if (!first) throw new Error("no identities shipped");
    expect(findIdentity(first.id)).toEqual(first);
    expect(findIdentity("does-not-exist")).toBeUndefined();
  });
});
