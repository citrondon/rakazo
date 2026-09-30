import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type TeamTemplate, TeamTemplateSchema } from "@rakazo/contracts";

/**
 * Shipped team templates. They sit as JSON next to the bot presets they name, so
 * a team is reviewable as data and needs no build step. Every file is parsed
 * against the contract on read: a template that does not validate is a bug in the
 * repository, not a surprise for whoever picks it.
 */
const BOT_LIBRARY_DIR = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../bot-library",
);
const TEAMS_DIR = path.join(BOT_LIBRARY_DIR, "teams");

export function listTeamTemplates(): TeamTemplate[] {
  if (!existsSync(TEAMS_DIR)) return [];
  return readdirSync(TEAMS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) =>
      TeamTemplateSchema.parse(JSON.parse(readFileSync(path.join(TEAMS_DIR, name), "utf8"))),
    );
}

/** The template a user picked, or undefined when there is no such team. */
export function findTeamTemplate(id: string): TeamTemplate | undefined {
  return listTeamTemplates().find((template) => template.id === id);
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
