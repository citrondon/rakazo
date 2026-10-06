import { BOT_INSTRUCTIONS_MAX_LENGTH } from "@rakazo/contracts";
import { nextCronDateAcrossStrict } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import {
  composeTeamInstructions,
  findIdentity,
  findTeamTemplate,
  listBotPresets,
  listIdentities,
  listTeamTemplates,
  prepareTeamStart,
  readBotPreset,
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

describe("composing a member's instructions", () => {
  // The roster's role line is a label for the start screen; the duty and the shared
  // protocol are instruction text, and they have to arrive in that order below the
  // preset's own prompt, which stays the base. Whitespace around a part is not content.
  it("stacks the duty and the shared rules under the preset prompt", () => {
    expect(
      composeTeamInstructions({
        presetInstructions: "  Preset prompt  ",
        duty: " Stage duty ",
        protocol: " Shared rules ",
      }),
    ).toBe("Preset prompt\n\nStage duty\n\nShared rules");
  });

  it("leaves the preset prompt alone when the roster adds nothing", () => {
    expect(composeTeamInstructions({ presetInstructions: "Prompt" })).toBe("Prompt");
    expect(
      composeTeamInstructions({ presetInstructions: "Prompt", duty: "   ", protocol: "" }),
    ).toBe("Prompt");
  });

  // A prompt plus a protocol can outgrow what a bot accepts, and a start must not fail
  // on that: the composed text is cut to the limit the profile allows.
  it("stays within the instruction limit a bot accepts", () => {
    const composed = composeTeamInstructions({
      presetInstructions: "p".repeat(BOT_INSTRUCTIONS_MAX_LENGTH),
      duty: "d".repeat(500),
      protocol: "r".repeat(500),
    });

    expect(composed.length).toBe(BOT_INSTRUCTIONS_MAX_LENGTH);
  });
});

describe("the software factory roster", () => {
  const template = findTeamTemplate("software-factory");

  // A roster that ships automation has to ship a schedule the parser accepts: the
  // start writes the routine's first date, and a cron nobody can read would fail the
  // whole start after the bots already exist.
  it("arms a round for its lead on a schedule the parser reads", () => {
    if (!template) throw new Error("the software factory roster is not shipped");
    const automation = template.automation;
    if (!automation) throw new Error("the software factory roster ships no automation");

    expect(automation.active).toBe(true);
    expect(automation.crons.length).toBeGreaterThan(0);
    expect(automation.prompt.trim().length).toBeGreaterThan(0);
    expect(template.firstTask.length).toBeGreaterThan(0);
    // The routine joins the group chat the start opens, so the roster's first member
    // is the bot that has to receive it.
    expect(template.members[0]?.preset).toBe("executive-chief");
    expect(
      nextCronDateAcrossStrict(
        automation.crons,
        new Date("2026-10-06T06:00:00.000Z"),
        automation.timezone,
      ),
    ).toBeInstanceOf(Date);
  });

  // Every member works on the same computer, so the shared rules are what keep the
  // rounds from colliding; a roster without them would start four bots with no
  // common way to hand work over.
  it("gives every member the shared protocol", () => {
    if (!template) throw new Error("the software factory roster is not shipped");
    expect(template.protocol?.trim().length).toBeGreaterThan(0);
    for (const member of prepareTeamStart(template).bots) {
      expect(member.instructions, member.preset).toContain(template.protocol?.trim() ?? "");
      expect(member.instructions.length, member.preset).toBeLessThanOrEqual(
        BOT_INSTRUCTIONS_MAX_LENGTH,
      );
    }
  });
});

describe("shipped bot presets", () => {
  const presets = listBotPresets();

  it("lists a preset for every file the library holds", () => {
    expect(presets.length).toBeGreaterThan(0);
    expect(new Set(presets.map((preset) => preset.slug)).size).toBe(presets.length);
  });

  // A picker hands the slug back to the import path, so a slug that does not
  // round-trip would offer a preset nobody can actually open.
  it("gives every preset a slug the library resolves", () => {
    for (const preset of presets) {
      expect(teamPresetManifestPath(preset.slug), preset.slug).toBeDefined();
    }
  });

  it("carries what a picker shows for every preset", () => {
    for (const preset of presets) {
      expect(preset.name.length, preset.slug).toBeGreaterThan(0);
      expect(preset.description.length, preset.slug).toBeGreaterThan(0);
    }
  });

  // Integrations live on the manifest, not on the bot. A preset that writes them
  // inside `bot` loses them to the contract and shows an empty list on import.
  it("carries the integrations a preset declares through to the summary", () => {
    expect(presets.some((preset) => preset.integrations.length > 0)).toBe(true);
  });

  // A picker hands the slug back to this lookup, so it has to refuse anything the
  // library does not ship instead of resolving a path of its own.
  it("reads one preset by slug and refuses a slug the library does not ship", () => {
    expect(readBotPreset("openresearch")?.bot.name).toBe("OpenResearch");
    expect(readBotPreset("does-not-exist")).toBeUndefined();
    expect(readBotPreset("../package")).toBeUndefined();
  });
});
