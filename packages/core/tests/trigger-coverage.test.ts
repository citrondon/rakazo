import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nextCronDateAcrossStrict } from "../src/cron";

type PresetRoutine = {
  name?: string;
  prompt?: string;
  crons?: readonly string[];
  timezone?: string;
};
type Preset = { routines?: readonly PresetRoutine[] };

const libraryDir = fileURLToPath(new URL("../../../bot-library/", import.meta.url));
const presetFiles = readdirSync(libraryDir)
  .filter((file) => file.endsWith(".v1.json"))
  .sort();

function readPreset(file: string): Preset {
  return JSON.parse(readFileSync(`${libraryDir}${file}`, "utf8")) as Preset;
}

describe("shipped preset routines", () => {
  it("ships presets to check", () => {
    expect(presetFiles.length).toBeGreaterThan(50);
  });

  it("parses every preset the library ships", () => {
    for (const file of presetFiles) expect(() => readPreset(file), file).not.toThrow();
  });

  it("gives every routine a prompt and a schedule the parser reads", () => {
    let routines = 0;
    for (const file of presetFiles) {
      for (const routine of readPreset(file).routines ?? []) {
        routines += 1;
        expect(routine.prompt?.trim(), `${file}: ${routine.name}`).toBeTruthy();
        const crons = routine.crons ?? [];
        expect(crons.length, `${file}: ${routine.name} ships no schedule`).toBeGreaterThan(0);
        for (const cron of crons)
          expect(
            nextCronDateAcrossStrict(
              [cron],
              new Date("2026-10-06T06:00:00.000Z"),
              routine.timezone ?? "UTC",
            ),
            `${file}: ${routine.name} -> ${cron}`,
          ).toBeInstanceOf(Date);
      }
    }
    expect(routines, "no preset ships a routine").toBeGreaterThan(0);
  });
});
