import type { BotImportInput } from "@rakazo/contracts";
import {
  BOT_DESCRIPTION_MAX_LENGTH,
  BOT_INSTRUCTIONS_MAX_LENGTH,
  BOT_NAME_MAX_LENGTH,
  BOT_TITLE_MAX_LENGTH,
} from "@rakazo/contracts";
import {
  hasMixedOneShotSchedule,
  isOneShotRoutineCrons,
  nextCronDateAcrossStrict,
  parseSkillMd,
} from "@rakazo/core";

export type PreparedBotImport = {
  profile: {
    name: string;
    title: string;
    description: string;
    instructions: string;
  };
  memory: Map<string, string>;
  routines: Array<{ name: string; prompt: string; crons: string[]; timezone: string }>;
  /** Skill name as its SKILL.md frontmatter states it, plus the content to create. */
  skills: Array<{ name: string; content: string }>;
  files: Array<{ path: string; content: string }>;
};

/** Home/agent files and memory always live below the root; reject anything else. */
function safeRelativePath(raw: string): string | null {
  const path = raw.replace(/^\/+/, "").replace(/\\/g, "/").trim();
  if (!path) return null;
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".."))
    return null;
  return segments.join("/");
}

/**
 * Turn an export manifest into the durable parts an import may create.
 * Never throws for per-item problems: anything unusable is dropped with a
 * warning so one broken routine cannot block the rest of the preset.
 *
 * Unlike the create flow, description and instructions stay separate: an
 * export carries a real instruction prompt that must not be overwritten by
 * the (usually one-line) description.
 */
export function prepareBotImport(input: BotImportInput, warnings: string[]): PreparedBotImport {
  const { manifest } = input;
  const profile = {
    name: manifest.bot.name.trim().slice(0, BOT_NAME_MAX_LENGTH) || "Imported bot",
    title: manifest.bot.title.trim().slice(0, BOT_TITLE_MAX_LENGTH),
    description: manifest.bot.description.trim().slice(0, BOT_DESCRIPTION_MAX_LENGTH),
    instructions: manifest.bot.instructions.trim().slice(0, BOT_INSTRUCTIONS_MAX_LENGTH),
  };

  const memory = new Map<string, string>();
  if (input.includeMemory) {
    for (const doc of manifest.memory) {
      const path = safeRelativePath(doc.path);
      if (!path) {
        warnings.push(`Memory skipped (unsafe path): ${doc.path}`);
        continue;
      }
      memory.set(path, doc.content);
    }
  }

  const routines: PreparedBotImport["routines"] = [];
  if (input.includeRoutines) {
    const seen = new Set<string>();
    for (const routine of manifest.routines) {
      const name = routine.name.trim().slice(0, 200);
      if (!name) {
        warnings.push("Routine skipped (empty name).");
        continue;
      }
      if (seen.has(name)) {
        warnings.push(`Duplicate routine skipped: ${name}`);
        continue;
      }
      if (hasMixedOneShotSchedule(routine.crons)) {
        warnings.push(`Routine skipped (one-time schedule mixed with recurring): ${name}`);
        continue;
      }
      const recurring = routine.crons.length > 0 && !isOneShotRoutineCrons(routine.crons);
      if (recurring) {
        try {
          const next = nextCronDateAcrossStrict(routine.crons, new Date(), routine.timezone);
          if (!next) throw new Error("No next date");
        } catch {
          warnings.push(`Routine skipped (invalid schedule): ${name}`);
          continue;
        }
      }
      seen.add(name);
      routines.push({
        name,
        prompt: routine.prompt,
        crons: routine.crons,
        timezone: routine.timezone,
      });
    }
  }

  const skills: PreparedBotImport["skills"] = [];
  if (input.includeSkills) {
    const seen = new Set<string>();
    for (const skill of manifest.skills) {
      // The content is the source of truth: a manifest name that disagrees with the
      // frontmatter would create a skill the bot's `@mention` cannot find.
      const parsed = parseSkillMd(skill.content);
      if ("error" in parsed) {
        warnings.push(`Skill skipped (not valid SKILL.md): ${skill.name}`);
        continue;
      }
      const key = parsed.name.toLowerCase();
      if (seen.has(key)) {
        warnings.push(`Duplicate skill skipped: ${parsed.name}`);
        continue;
      }
      seen.add(key);
      skills.push({ name: parsed.name, content: skill.content });
    }
  }

  const files: PreparedBotImport["files"] = [];
  if (input.includeFiles) {
    for (const file of manifest.files) {
      const path = safeRelativePath(file.path);
      if (!path) {
        warnings.push(`File skipped (unsafe path): ${file.path}`);
        continue;
      }
      files.push({ path, content: file.content });
    }
  }

  return { profile, memory, routines, skills, files };
}
