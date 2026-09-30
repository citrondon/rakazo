import { describe, expect, it } from "vitest";
import { MCP_PRESETS, stdioBlockerReason } from "./mcp-presets";

// A preset is a promise the gallery makes on the user's behalf: click this and your bots
// gain the tool. So it must never carry a developer machine's paths or OS-specific copy.
const DEPENDENCY_PATH = /^(?:[A-Za-z]:[\\/]|\/Users\/|~)/;

describe("MCP presets", () => {
  it("lists presets", () => {
    expect(MCP_PRESETS.length).toBeGreaterThan(0);
  });

  it("has unique ids and slugs", () => {
    const ids = MCP_PRESETS.map((preset) => preset.id);
    const slugs = MCP_PRESETS.map((preset) => preset.slug);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  for (const preset of MCP_PRESETS) {
    describe(preset.id, () => {
      it("names no developer machine path", () => {
        for (const arg of preset.args) {
          expect(DEPENDENCY_PATH.test(arg), arg).toBe(false);
        }
      });

      it("addresses files as {home}, never as an absolute path on one container", () => {
        // stdio servers spawn next to the API, so a hard-coded mount is a path that does not exist.
        for (const arg of preset.args) {
          expect(arg.startsWith("/"), arg).toBe(false);
        }
      });

      it("describes the product, not a host operating system", () => {
        expect(preset.description).not.toMatch(/windows|macos|linux/i);
      });

      it("starts once its command is allowlisted", () => {
        expect(stdioBlockerReason(preset, null)).toBeNull();
        expect(
          stdioBlockerReason(preset, { enabled: false, allowedCommands: [preset.command] }),
        ).toBe("disabled");
        expect(stdioBlockerReason(preset, { enabled: true, allowedCommands: [] })).toBe("command");
        expect(
          stdioBlockerReason(preset, { enabled: true, allowedCommands: [preset.command] }),
        ).toBeNull();
      });
    });
  }
});
