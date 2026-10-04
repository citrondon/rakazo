import { describe, expect, it } from "vitest";
import { sandboxProcessKillCommand, sandboxProcessWrapper } from "./supervisor-logic.js";

describe("sandbox process helpers", () => {
  it("records the child pid so a live process can be killed from inside the container", () => {
    expect(sandboxProcessWrapper(["node", "server.js"], "/tmp/rakazo-mcp-1.pid")).toEqual([
      "sh",
      "-c",
      'echo $$ > "$0"; exec "$@"',
      "/tmp/rakazo-mcp-1.pid",
      "node",
      "server.js",
    ]);
  });

  it("kills through the recorded pid and tolerates a process that already exited", () => {
    expect(sandboxProcessKillCommand("/tmp/rakazo-mcp-1.pid")).toEqual([
      "sh",
      "-c",
      'kill -TERM "$(cat "$0")" 2>/dev/null || true',
      "/tmp/rakazo-mcp-1.pid",
    ]);
  });
});
