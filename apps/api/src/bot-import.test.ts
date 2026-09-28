import type { BotImportInput } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { prepareBotImport } from "./bot-import.js";

function manifestFixture(overrides?: {
  name?: string;
  memory?: Array<{ path: string; content: string }>;
  routines?: Array<{ name: string; prompt: string; crons: string[]; timezone: string }>;
  files?: Array<{ path: string; content: string }>;
}): BotImportInput {
  return {
    manifest: {
      version: 1,
      exportedAt: "2026-09-27T00:00:00.000Z",
      bot: {
        name: overrides?.name ?? "Researcher",
        title: "Research Agent",
        description: "A research helper.",
        instructions: "You research things carefully.",
      },
      memory: overrides?.memory ?? [],
      routines: overrides?.routines ?? [],
      files: overrides?.files ?? [],
      history: [],
    },
    includeMemory: true,
    includeRoutines: true,
    includeFiles: true,
  };
}

describe("prepareBotImport", () => {
  it("keeps description and instructions separate", () => {
    const prepared = prepareBotImport(manifestFixture(), []);
    expect(prepared.profile).toEqual({
      name: "Researcher",
      title: "Research Agent",
      description: "A research helper.",
      instructions: "You research things carefully.",
    });
  });

  it("falls back to a default name when the preset name is empty", () => {
    const prepared = prepareBotImport(manifestFixture({ name: "   " }), []);
    expect(prepared.profile.name).toBe("Imported bot");
  });

  it("drops memory with unsafe paths and keeps the rest", () => {
    const prepared = prepareBotImport(
      manifestFixture({
        memory: [
          { path: "MEMORY.md", content: "# ok" },
          { path: "../escape.md", content: "bad" },
          { path: "", content: "empty" },
        ],
      }),
      [],
    );
    expect(prepared.memory.has("MEMORY.md")).toBe(true);
    expect(prepared.memory.size).toBe(1);
  });

  it("skips duplicate and invalid routines with warnings", () => {
    const warnings: string[] = [];
    const prepared = prepareBotImport(
      manifestFixture({
        routines: [
          { name: "Weekly", prompt: "do it", crons: ["0 9 * * 1"], timezone: "UTC" },
          { name: "Weekly", prompt: "again", crons: ["0 9 * * 1"], timezone: "UTC" },
          { name: "", prompt: "no name", crons: [], timezone: "UTC" },
        ],
      }),
      warnings,
    );
    expect(prepared.routines).toHaveLength(1);
    expect(warnings.some((warning) => warning.includes("Duplicate"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("empty name"))).toBe(true);
  });

  it("rejects files with traversal paths", () => {
    const prepared = prepareBotImport(
      manifestFixture({
        files: [{ path: "a/../../b.txt", content: "bad" }],
      }),
      [],
    );
    expect(prepared.files).toHaveLength(0);
  });

  it("respects include flags", () => {
    const input = manifestFixture({
      memory: [{ path: "MEMORY.md", content: "mem" }],
      routines: [{ name: "R", prompt: "p", crons: [], timezone: "UTC" }],
      files: [{ path: "notes.txt", content: "f" }],
    });
    const prepared = prepareBotImport({ ...input, includeMemory: false }, []);
    expect(prepared.memory.size).toBe(0);
    expect(prepared.routines).toHaveLength(1);
    expect(prepared.files).toHaveLength(1);
  });
});
