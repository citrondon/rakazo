import type { ComputerRef, ProcessEvent } from "@rakazo/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DockerSandboxProvider,
  MAX_SANDBOX_PROCESS_STREAM_BYTES,
  MAX_SANDBOX_SUCCESS_RESPONSE_BYTES,
} from "./docker-sandbox.js";

const computer = {
  id: "computer",
  botId: "bot",
  kind: "docker",
  providerRef: "computer",
} satisfies ComputerRef;
const context = {
  spaceId: "space",
  userId: "user",
  botId: "bot",
  runId: "run",
  signal: new AbortController().signal,
} as never;

function jsonBody(call: { init?: RequestInit }): unknown {
  const headers = new Headers(call.init?.headers);
  if (!headers.get("content-type")?.includes("json")) return undefined;
  return JSON.parse(String(call.init?.body));
}

describe("Docker sandbox process channel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts a process, writes one framed jsonrpc line per call, and stops it again", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (String(url).endsWith("/processes")) return Response.json({ processId: "p-1" });
        if (String(url).endsWith("/events"))
          return new Response(
            new ReadableStream({
              async start(controller) {
                const encoder = new TextEncoder();
                controller.enqueue(
                  encoder.encode(`${JSON.stringify({ type: "stdout", data: "{}\n" })}\n`),
                );
                controller.enqueue(
                  encoder.encode(`${JSON.stringify({ type: "exit", code: 0 })}\n`),
                );
                controller.close();
              },
            }),
            { headers: { "content-type": "application/x-ndjson" } },
          );
        return Response.json({ ok: true });
      }),
    );
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    const handle = await provider.openProcess!(computer, { argv: ["node", "s.js"] }, context);
    await handle.write('{"jsonrpc":"2.0","id":1}\n');
    const seen: ProcessEvent[] = [];
    for await (const event of handle.events()) seen.push(event);
    await handle.kill();

    expect(calls.map((call) => call.url)).toEqual([
      "http://supervisor.test/computers/computer/processes",
      "http://supervisor.test/computers/computer/processes/p-1/stdin",
      "http://supervisor.test/computers/computer/processes/p-1/events",
      "http://supervisor.test/computers/computer/processes/p-1",
    ]);
    expect(seen).toEqual([
      { type: "stdout", data: "{}\n" },
      { type: "exit", code: 0 },
    ]);
    // One frame per POST, exactly as the supervisor route expects it.
    expect(jsonBody(calls[1]!)).toEqual({ data: '{"jsonrpc":"2.0","id":1}\n' });
    // The channel is opened exactly once; a second iterator would split the frames.
    expect(() => handle.events()).toThrow();
    // Both stream caps stay distinct: the one-shot exec cap and the long-lived channel cap.
    expect(MAX_SANDBOX_SUCCESS_RESPONSE_BYTES).toBe(16 * 1024 * 1024);
    expect(MAX_SANDBOX_PROCESS_STREAM_BYTES).toBe(64 * 1024 * 1024);
  });

  it("fails a stdin write loudly with the process named when the supervisor answers 409", async () => {
    // A transport that trusts a silent write would wait forever on a dead pipe.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/processes")) return Response.json({ processId: "p-9" });
        return Response.json({ error: "process is not running" }, { status: 409 });
      }),
    );
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    const handle = await provider.openProcess!(computer, { argv: ["node", "s.js"] }, context);
    await expect(handle.write('{"jsonrpc":"2.0","id":2}\n')).rejects.toThrow("p-9");
  });

  it("addresses the channel as the computer's bot, not as the calling run", async () => {
    const startCalls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        startCalls.push({ url, init });
        return Response.json({ processId: "p-1" });
      }),
    );
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    await provider.openProcess!(computer, { argv: ["node", "s.js"] }, context);
    const headers = new Headers(startCalls[0]!.init?.headers);
    expect(headers.get("x-rakazo-bot-id")).toBe(computer.botId);
    expect(headers.get("authorization")).toBe("Bearer test-token");
  });
});
