import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import type { AdapterContext, ComputerRef } from "@rakazo/adapter-kit";
import { DockerSandboxProvider } from "@rakazo/adapters";
import { describe, expect, it } from "vitest";

/**
 * Gated container proof for the sandboxed stdio MCP process channel.
 *
 * What this proves: a long-lived process started through the real supervisor route
 * `POST /computers/:id/processes` (`node -e` as a newline-delimited stdin echo), frames
 * written and read back over the real dockerode-hijacked duplex channel, then `DELETE`
 * stops it and `pgrep` inside the container shows no process left. That is the only part
 * where dockerode hijack, supervisor routes and the provider are exercised together for real.
 *
 * What this does NOT prove: the MCP handshake itself. A real stdio MCP package would be a
 * network download, which is not a deterministic offline test; the handshake stays covered
 * by the Task 6 tests against the fake process handle. Do not sell this file as "E2E green".
 */
function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "pipe",
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

const hasDocker = process.env.VERIFY_DATABASE === "1" && dockerAvailable();
const describeWithDocker = hasDocker ? describe : describe.skip;

describeWithDocker("stdio MCP sandbox process channel (real Docker)", () => {
  it("starts a process over the route, echoes frames over the hijack and leaves nothing after DELETE", async () => {
    if (!hasDocker) {
      // Skipped with a stated reason: needs VERIFY_DATABASE=1 AND a reachable Docker daemon.
      return;
    }
    // The supervisor reads DATA_DIR and its token at import time, so pin both to a private
    // temporary layout before the dynamic import; nothing here touches the repository's data.
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "rakazo-mcp-stdio-proof-"));
    const supervisorToken = `proof-${randomUUID()}`;
    process.env.DATA_DIR = dataDir;
    process.env.SANDBOX_SUPERVISOR_TOKEN = supervisorToken;
    const { supervisorApp } = await import("../../../infra/sandboxes/supervisor/src/index.js");
    const server = serve({ fetch: supervisorApp.fetch, hostname: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.once("listening", () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    const sandbox = new DockerSandboxProvider(`http://127.0.0.1:${port}`, supervisorToken);
    const botId = `mcp-stdio-proof-${randomUUID()}`;
    const context: AdapterContext = {
      operationId: `mcp-stdio-proof-${randomUUID()}`,
      traceId: "mcp-stdio-proof",
      spaceId: "proof-space",
      userId: "proof-user",
      botId,
      signal: AbortSignal.timeout(240_000),
    };
    let computer: ComputerRef | undefined;
    try {
      computer = await sandbox.provision(
        { botId, homePath: path.join(dataDir, "homes", botId) },
        context,
      );
      // The marker lives in the process command line so pgrep inside the container can
      // see exactly this proof process — and nothing else. The pgrep pattern brackets the
      // first character (`[s]dd-…`): the marker is also an argument of the `timeout … sh -c`
      // wrapper that runs every /exec, so an unwrapped `pgrep -f <marker>` would match that
      // wrapper shell forever and never prove the process is gone. The bracket keeps the
      // regex matching the node command line while the literal in the wrapper stays a
      // non-match.
      const marker = `sdd-proof-${randomUUID()}`;
      const pgrepPattern = `[${marker[0]}]${marker.slice(1)}`;
      const echoSource =
        "// " +
        marker +
        '\nconst rl = require("readline").createInterface({ input: process.stdin });' +
        'rl.on("line", (line) => process.stdout.write("echo:" + line + "\\n"));';
      const processHandle = await sandbox.openProcess(
        computer,
        { argv: ["node", "-e", echoSource], env: {}, cwd: undefined },
        context,
      );
      const events = processHandle.events();
      const collected: string[] = [];
      const reader = (async () => {
        for await (const event of events) {
          if (event.type === "stdout" && event.data) collected.push(event.data);
        }
      })();
      // A running process is visible to pgrep before the DELETE; readEvents needs a tick
      // to open the stream, so wait for the channel to accept a frame first.
      await processHandle.write("ping\n");
      const deadline = Date.now() + 15_000;
      while (!collected.join("").includes("echo:ping\n")) {
        if (Date.now() > deadline) throw new Error(`no echo within 15 s: ${collected}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const running = await drainExec(sandbox, computer, context, ["pgrep", "-f", pgrepPattern]);
      expect(running.code).toBe(0);
      await processHandle.kill();
      // Give SIGTERM a moment to land before demanding the process table is clean.
      const gone = await waitForPgexit(sandbox, computer, context, pgrepPattern);
      expect(gone).toBe(true);
      // The event stream ends with the process; drain the reader so nothing hangs on close.
      await reader;
    } finally {
      if (computer) {
        await sandbox
          .destroy(computer, { ...context, signal: AbortSignal.timeout(30_000) })
          .catch(() => undefined);
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
  }, 240_000);
});

async function drainExec(
  sandbox: DockerSandboxProvider,
  computer: ComputerRef,
  context: AdapterContext,
  argv: string[],
): Promise<{ stdout: string; code: number }> {
  let stdout = "";
  let code = -1;
  for await (const event of sandbox.execute(computer, { argv, env: {}, cwd: undefined }, context)) {
    if (event.type === "stdout") stdout += event.data;
    if (event.type === "exit") code = event.code ?? -1;
  }
  return { stdout, code };
}

/** pgrep exits 1 once no matching process remains; poll briefly for the SIGTERM to land. */
async function waitForPgexit(
  sandbox: DockerSandboxProvider,
  computer: ComputerRef,
  context: AdapterContext,
  marker: string,
): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = await drainExec(sandbox, computer, context, ["pgrep", "-f", marker]);
    if (result.code !== 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}
