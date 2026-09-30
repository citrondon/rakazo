import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_AGENT_SKILLS } from "@rakazo/adapters";
import { type BotImportInput, type ExportManifest, ExportManifestSchema } from "@rakazo/contracts";
import { extractRoutineSkillMentions } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import { prepareBotImport } from "./bot-import.js";

const libraryDir = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../bot-library",
);

function shippedPresets(): Array<{ file: string; manifest: ExportManifest }> {
  return readdirSync(libraryDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((file) => ({
      file,
      manifest: ExportManifestSchema.parse(
        JSON.parse(readFileSync(path.join(libraryDir, file), "utf8")),
      ),
    }));
}

function importOf(manifest: ExportManifest): BotImportInput {
  return { manifest, includeMemory: true, includeRoutines: true, includeFiles: true };
}

describe("shipped bot presets", () => {
  it("finds the preset library", () => {
    expect(shippedPresets().length).toBeGreaterThan(0);
  });

  for (const { file, manifest } of shippedPresets()) {
    describe(file, () => {
      it("imports every entry without dropping any", () => {
        const warnings: string[] = [];
        const prepared = prepareBotImport(importOf(manifest), warnings);
        expect(warnings).toEqual([]);
        expect(prepared.memory.size).toBe(manifest.memory.length);
        expect(prepared.routines.length).toBe(manifest.routines.length);
        expect(prepared.files.length).toBe(manifest.files.length);
      });

      // A preset that tells the bot to run a script no sandbox ships is worse than no
      // preset: the routine keeps firing on schedule and fails quietly every time.
      it("names only tools and paths that exist at run time", () => {
        const prose = [
          manifest.bot.instructions,
          ...manifest.routines.map((routine) => routine.prompt),
          ...manifest.memory.map((entry) => entry.content),
        ].join("\n");
        expect(prose).not.toMatch(/[A-Za-z]:\\|(?:shared|workspace)\/tools\//);
        expect(prose).not.toMatch(/python[0-9]?\s+\//);
      });

      it("gives every routine a prompt and a schedule", () => {
        for (const routine of manifest.routines) {
          expect(routine.prompt.trim().length).toBeGreaterThan(0);
          expect(routine.crons.length).toBeGreaterThan(0);
        }
      });

      // Routines expand @Skill mentions when they fire; a name nothing ships would be dropped.
      it("mentions only skills the product ships", () => {
        const builtinNames = BUILTIN_AGENT_SKILLS.map((skill) => skill.name);
        for (const routine of manifest.routines) {
          for (const mention of extractRoutineSkillMentions(routine.prompt)) {
            expect(builtinNames, `${file}: @${mention}`).toContain(mention);
          }
        }
      });
    });
  }
});
