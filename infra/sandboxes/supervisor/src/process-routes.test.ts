import { Duplex, PassThrough, Readable, Writable } from "node:stream";
import { resolveSupervisorToken } from "@rakazo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  exec: vi.fn(),
  inspect: vi.fn(),
  liveStreams: [] as PassThrough[],
}));
vi.mock("dockerode", () => ({
  default: class {
    getContainer() {
      return mock;
    }
  },
}));

import { MAX_SUPERVISOR_REQUEST_BYTES, supervisorApp } from "./index.js";

const ID = "computer-1";

function identityHeaders(extra: Record<string, string> = {}) {
  return {
    authorization: `Bearer ${resolveSupervisorToken(process.env)}`,
    "content-type": "application/json",
    "x-rakazo-bot-id": "home",
    "x-rakazo-space-id": "space",
    ...extra,
  };
}

async function startProcess(argv: string[]) {
  return supervisorApp.request(`/computers/${ID}/processes`, {
    method: "POST",
    headers: identityHeaders(),
    body: JSON.stringify({ argv }),
  });
}

/** A hijacked exec stream that stays open: the process lives until the test kills it. */
function liveStream() {
  return new PassThrough();
}

/** An exec stream that ends at once: what runContainerCommand needs for the kill itself. */
function finishedStream() {
  return Duplex.from({
    readable: Readable.from([Buffer.alloc(0)]),
    writable: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  });
}

beforeEach(() => {
  mock.exec.mockReset();
  mock.inspect.mockReset();
  mock.liveStreams.length = 0;
  mock.inspect.mockResolvedValue({
    Config: {
      Labels: { "rakazo.managed": "true", "rakazo.botId": "home", "rakazo.spaceId": "space" },
    },
  });
  mock.exec.mockImplementation(async (options: { Cmd: string[] }) => {
    const command = options.Cmd.join(" ");
    if (command.includes("echo $$ >")) {
      const stream = liveStream();
      mock.liveStreams.push(stream);
      return {
        start: async () => stream,
        inspect: async () => ({ ExitCode: 0 }),
      };
    }
    return {
      start: async () => finishedStream(),
      inspect: async () => ({ ExitCode: 0 }),
    };
  });
});

describe("sandbox process routes", () => {
  it("streams events as ndjson without a request body, so bodyLimit cannot buffer it", async () => {
    const started = await startProcess(["node", "server.js"]);
    expect(started.status).toBe(200);
    const { processId } = (await started.json()) as { processId: string };

    const events = await supervisorApp.request(`/computers/${ID}/processes/${processId}/events`, {
      headers: identityHeaders(),
    });
    expect(events.status).toBe(200);
    expect(events.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(events.headers.get("x-accel-buffering")).toBe("no");
  });

  it("refuses a stdin frame for a process that is gone", async () => {
    // 409 is the only answer the client can tell apart from "frame taken".
    const res = await supervisorApp.request(`/computers/${ID}/processes/nope/stdin`, {
      method: "POST",
      headers: identityHeaders(),
      body: JSON.stringify({ data: "{}\n" }),
    });
    expect(res.status).toBe(409);
  });

  it("passes a Content-Length stdin frame through the body limit unread, up to the 1 MiB cap", async () => {
    const started = await startProcess(["node", "server.js"]);
    const { processId } = (await started.json()) as { processId: string };
    const frame = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`;

    const ok = await supervisorApp.request(`/computers/${ID}/processes/${processId}/stdin`, {
      method: "POST",
      headers: identityHeaders(),
      // {data} per the route contract; fetch sets content-length for a string body — the premise.
      body: JSON.stringify({ data: frame }),
    });
    expect(ok.status).toBe(200);
    // The same route with a body over MAX_SUPERVISOR_REQUEST_BYTES: the middleware answers 413
    // before the handler reads. That is the cap spec 4.2 demands — shown here, not asserted.
    const tooLarge = await supervisorApp.request(`/computers/${ID}/processes/${processId}/stdin`, {
      method: "POST",
      headers: identityHeaders(),
      body: "x".repeat(MAX_SUPERVISOR_REQUEST_BYTES + 1),
    });
    expect(tooLarge.status).toBe(413);
    await expect(tooLarge.json()).resolves.toEqual({ error: "Request body is too large." });
  });

  it("rejects a missing or empty argv with 422 before touching the container", async () => {
    for (const body of [{}, { argv: [] }]) {
      const res = await supervisorApp.request(`/computers/${ID}/processes`, {
        method: "POST",
        headers: identityHeaders(),
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      await expect(res.json()).resolves.toEqual({
        error: "argv must be a non-empty array of strings",
      });
    }
    expect(mock.exec).not.toHaveBeenCalled();
  });

  it("answers 403 on an identity mismatch, not the exec shape of 200 with code 1", async () => {
    const res = await supervisorApp.request(`/computers/${ID}/processes`, {
      method: "POST",
      headers: identityHeaders({ "x-rakazo-bot-id": "foreign-home" }),
      body: JSON.stringify({ argv: ["node", "server.js"] }),
    });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "invalid computer identity" });
    expect(mock.exec).not.toHaveBeenCalled();
  });

  it("kills a process DELETEd right after the start, before any reader attached", async () => {
    // The race the reservation exists for: close finds an entry even with no reader yet.
    const started = await startProcess(["node", "server.js"]);
    const { processId } = (await started.json()) as { processId: string };

    const deleted = await supervisorApp.request(`/computers/${ID}/processes/${processId}`, {
      method: "DELETE",
      headers: identityHeaders(),
    });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ ok: true });
    expect(mock.exec.mock.calls.at(-1)?.[0].Cmd.join(" ")).toContain("kill -TERM");
    expect(mock.liveStreams.at(-1)?.destroyed).toBe(true);

    const again = await supervisorApp.request(`/computers/${ID}/processes/${processId}`, {
      method: "DELETE",
      headers: identityHeaders(),
    });
    expect(again.status).toBe(404);
  });

  it("puts a request env entry after the computer default so it wins, as the host path does", async () => {
    await supervisorApp.request(`/computers/${ID}/processes`, {
      method: "POST",
      headers: identityHeaders(),
      body: JSON.stringify({ argv: ["node", "s.js"], env: { PATH: "/custom" } }),
    });
    const env = mock.exec.mock.calls[0]![0].Env as string[];
    expect(env.filter((entry) => entry.startsWith("PATH=")).at(-1)).toBe("PATH=/custom");
    expect(env.filter((entry) => entry.startsWith("PATH="))).toHaveLength(2);
    expect(env).toContain("HOME=/home/rakazo");
  });

  it("answers the reader of an ended process with 410 and an unknown id with 404", async () => {
    // Ruling: an ended process reports its end state to the reader before any stream opens;
    // a 200 here would hang. Proved over the live route, not as a unit case.
    const started = await startProcess(["node", "server.js"]);
    const { processId } = (await started.json()) as { processId: string };
    const deleted = await supervisorApp.request(`/computers/${ID}/processes/${processId}`, {
      method: "DELETE",
      headers: identityHeaders(),
    });
    expect(deleted.status).toBe(200);

    const ended = await supervisorApp.request(`/computers/${ID}/processes/${processId}/events`, {
      headers: identityHeaders(),
    });
    expect(ended.status).toBe(410);
    await expect(ended.json()).resolves.toEqual({ error: "process ended" });

    const unknown = await supervisorApp.request(`/computers/${ID}/processes/never-existed/events`, {
      headers: identityHeaders(),
    });
    expect(unknown.status).toBe(404);
    // The ended marker is owner-scoped too: a stranger still sees plain 404, nothing more.
    const stranger = await supervisorApp.request(
      `/computers/other-computer/processes/${processId}/events`,
      { headers: identityHeaders() },
    );
    expect(stranger.status).toBe(404);
  });

  it("keeps a channel request addressed to another computer from reaching the process", async () => {
    // The stored computerId is the identity check of the channel: a process belongs to the
    // computer that started it, and no route under a different computer may read or write it.
    const started = await startProcess(["node", "server.js"]);
    const { processId } = (await started.json()) as { processId: string };

    const events = await supervisorApp.request(
      `/computers/other-computer/processes/${processId}/events`,
      { headers: identityHeaders() },
    );
    expect(events.status).toBe(404);
    const stdin = await supervisorApp.request(
      `/computers/other-computer/processes/${processId}/stdin`,
      { method: "POST", headers: identityHeaders(), body: JSON.stringify({ data: "{}\n" }) },
    );
    expect(stdin.status).toBe(409);
    const deleted = await supervisorApp.request(
      `/computers/other-computer/processes/${processId}`,
      { method: "DELETE", headers: identityHeaders() },
    );
    expect(deleted.status).toBe(404);
  });
});
