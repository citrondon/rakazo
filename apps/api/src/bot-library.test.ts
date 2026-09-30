import { describe, expect, it } from "vitest";
import {
  findIdentity,
  findTeamTemplate,
  listIdentities,
  listTeamTemplates,
  prepareTeamStart,
  resolveStartTeam,
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

describe("starting a team", () => {
  it("resolves a roster named directly or through an identity", () => {
    expect(resolveStartTeam({ templateId: "eng" })?.id).toBe("eng");
    for (const identity of listIdentities()) {
      expect(resolveStartTeam({ identityId: identity.id })?.id, identity.id).toBe(identity.team);
    }
  });

  // Starting the wrong team is worse than telling the caller the id was wrong.
  it("resolves nothing for an id the library does not ship", () => {
    expect(resolveStartTeam({ templateId: "does-not-exist" })).toBeUndefined();
    expect(resolveStartTeam({ identityId: "does-not-exist" })).toBeUndefined();
    expect(resolveStartTeam({})).toBeUndefined();
  });

  // Every roster the library offers has to be startable: this is where a template
  // and the presets it names are checked against each other.
  it("prepares every shipped roster, lead first", () => {
    for (const template of listTeamTemplates()) {
      const start = prepareTeamStart(template);
      expect(
        start.bots.map((member) => member.preset),
        template.id,
      ).toEqual(template.members.map((member) => member.preset));
      for (const member of start.bots) {
        const where = `${template.id}/${member.preset}`;
        expect(member.prepared.profile.name.length, where).toBeGreaterThan(0);
        expect(member.prepared.profile.instructions.length, where).toBeGreaterThan(0);
        expect(member.role.length, where).toBeGreaterThan(0);
      }
    }
  });

  // The lead's first task is what starts the work; a roster without one would
  // create idle bots.
  it("carries a first task for the lead", () => {
    const templates = listTeamTemplates();
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) {
      expect(template.firstTask.trim().length, template.id).toBeGreaterThan(0);
    }
  });

  // Resolution happens before the first bot exists, so a roster pointing at a
  // preset nobody ships fails with nothing half-created.
  it("fails before creating anything when a roster names an unknown preset", () => {
    expect(() =>
      prepareTeamStart({
        id: "broken",
        label: "Broken",
        summary: "Names a preset the library does not ship.",
        members: [
          { preset: "executive-chief", role: "Lead" },
          { preset: "does-not-exist", role: "Member" },
        ],
        integrations: [],
        firstTask: "Start.",
      }),
    ).toThrow(/does-not-exist/);
  });
});
