import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Identity,
  IdentitySchema,
  type TeamTemplate,
  TeamTemplateSchema,
} from "@rakazo/contracts";

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
    .map((name) => parse(JSON.parse(readFileSync(path.join(dir, name), "utf8"))));
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
