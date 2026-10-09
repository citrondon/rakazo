import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BotPresetSummary, ExportManifest, Identity, TeamTemplate } from "@bobbot/contracts";
import {
  BOT_INSTRUCTIONS_MAX_LENGTH,
  ExportManifestSchema,
  IdentitySchema,
  TeamTemplateSchema,
} from "@bobbot/contracts";
import type { PreparedBotImport } from "./bot-import.js";
import { prepareBotImport } from "./bot-import.js";

/**
 * Shipped library data. Rosters and identities sit as JSON next to the bot presets
 * they name, so the library is reviewable as data and needs no build step. Every
 * file is parsed against the contract on read: a file that does not validate is a
 * bug in the repository, not a surprise for whoever picks it.
 */
const BOT_LIBRARY_DIR = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../bot-library",
);
const TEAMS_DIR = path.join(BOT_LIBRARY_DIR, "teams");
const IDENTITIES_DIR = path.join(BOT_LIBRARY_DIR, "identities");

/** Files are read in name order, so a list is stable between runs. */
function readLibraryDir<T>(dir: string, parse: (value: unknown) => T): T[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => parse(readJsonFile(path.join(dir, name))));
}

/**
 * One JSON file of the shipped library. A file that is not valid JSON is a bug in the
 * repository, so it fails here with the file's name instead of a bare SyntaxError.
 */
function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Library file ${path.relative(BOT_LIBRARY_DIR, file)} is not valid JSON`, {
      cause: error,
    });
  }
}

export function listTeamTemplates(): TeamTemplate[] {
  return readLibraryDir(TEAMS_DIR, (value) => TeamTemplateSchema.parse(value));
}

/** The template a user picked, or undefined when there is no such team. */
export function findTeamTemplate(id: string): TeamTemplate | undefined {
  return listTeamTemplates().find((template) => template.id === id);
}

export function listIdentities(): Identity[] {
  return readLibraryDir(IDENTITIES_DIR, (value) => IdentitySchema.parse(value));
}

/** The identity a user picked, or undefined when there is no such identity. */
export function findIdentity(id: string): Identity | undefined {
  return listIdentities().find((identity) => identity.id === id);
}

/**
 * The preset file a member names, or undefined when the library does not ship it.
 * Safe because the contract only allows lowercase slugs, so no member name can
 * escape the library directory.
 */
export function teamPresetManifestPath(preset: string): string | undefined {
  const file = path.join(BOT_LIBRARY_DIR, `${preset}.v1.json`);
  return existsSync(file) ? file : undefined;
}

/**
 * Every preset the library ships. Read in name order so the list is stable between
 * runs, and parsed in full: a preset that does not validate is a bug in the
 * repository, and it should fail here rather than silently vanish from a browser.
 */
export function listBotPresets(): BotPresetSummary[] {
  return readdirSync(BOT_LIBRARY_DIR)
    .filter((name) => name.endsWith(".v1.json"))
    .sort()
    .map((name) => {
      const manifest = ExportManifestSchema.parse(readJsonFile(path.join(BOT_LIBRARY_DIR, name)));
      return {
        slug: name.slice(0, -".v1.json".length),
        name: manifest.bot.name,
        title: manifest.bot.title,
        description: manifest.bot.description,
        integrations: manifest.integrations,
        routineCount: manifest.routines.length,
        memoryCount: manifest.memory.length,
        fileCount: manifest.files.length,
      };
    });
}

/**
 * One shipped preset, by slug. Resolved through the same lookup a team member goes
 * through, so a slug that cannot name a library file cannot reach this either.
 */
export function readBotPreset(slug: string): ExportManifest | undefined {
  const file = teamPresetManifestPath(slug);
  if (!file) return undefined;
  return ExportManifestSchema.parse(readJsonFile(file));
}

/**
 * The roster a start request names. An identity stands for the team a new space
 * begins with, so it resolves to that team; an unknown id resolves to nothing
 * rather than to a default, because starting the wrong team is worse than
 * showing that the id was wrong.
 */
export function resolveStartTeam(input: {
  templateId?: string;
  identityId?: string;
}): TeamTemplate | undefined {
  if (input.templateId) return findTeamTemplate(input.templateId);
  if (!input.identityId) return undefined;
  const identity = findIdentity(input.identityId);
  return identity ? findTeamTemplate(identity.team) : undefined;
}

export type PreparedTeamStart = {
  template: TeamTemplate;
  /** Roster order: the first entry is the lead that receives the first task. */
  bots: Array<{
    preset: string;
    role: string;
    /** The preset's prompt plus this team's duty and shared rules. */
    instructions: string;
    prepared: PreparedBotImport;
  }>;
};

/**
 * A member's prompt is three layers, in this order: what the preset already says, what
 * this roster adds for this member, and the rules every member shares. `role` is not part
 * of it — the role line labels the roster, the duty is what the bot is told to own.
 */
export function composeTeamInstructions(input: {
  presetInstructions: string;
  duty?: string | undefined;
  protocol?: string | undefined;
}): string {
  return [input.presetInstructions.trim(), input.duty?.trim(), input.protocol?.trim()]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n\n")
    .slice(0, BOT_INSTRUCTIONS_MAX_LENGTH);
}

/**
 * Everything a team start needs, resolved before the first bot exists: a roster
 * naming a preset the library does not ship fails here, so creation can never
 * leave half a team behind. A starter team is an import of N presets, so each
 * member brings what a preset import brings — memory, routines and skills, no
 * home files — and the routines stay inactive until someone arms them, exactly
 * as an import leaves them.
 */
export function prepareTeamStart(template: TeamTemplate): PreparedTeamStart {
  const bots = template.members.map((member) => {
    const file = teamPresetManifestPath(member.preset);
    if (!file) throw new Error(`Team ${template.id} names an unknown preset: ${member.preset}`);
    const manifest: ExportManifest = ExportManifestSchema.parse(readJsonFile(file));
    const warnings: string[] = [];
    const prepared = prepareBotImport(
      {
        manifest,
        includeMemory: true,
        includeRoutines: true,
        includeSkills: true,
        includeFiles: false,
      },
      warnings,
    );
    // A shipped preset that imports with warnings is a repository bug, and the
    // preset test catches it; failing here keeps a team from starting with a
    // member whose preset was silently trimmed.
    if (warnings.length > 0) {
      throw new Error(`Team ${template.id}, preset ${member.preset}: ${warnings.join(" ")}`);
    }
    return {
      preset: member.preset,
      role: member.role,
      instructions: composeTeamInstructions({
        presetInstructions: prepared.profile.instructions,
        duty: member.instructions,
        protocol: template.protocol,
      }),
      prepared,
    };
  });
  return { template, bots };
}
