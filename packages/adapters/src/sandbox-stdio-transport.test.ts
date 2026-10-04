import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeSandboxProcess, flush } from "./sandbox-process-fake.js";
import { MCP_STDIO_MAX_BUFFERED_BYTES, SandboxStdioTransport } from "./sandbox-stdio-transport.js";

afterEach(() => vi.useRealTimers());

describe("sandbox stdio transport", () => {
  it("never drops a stdout frame: an unterminated overflow kills the process", async () => {
    const fake = fakeSandboxProcess();
    const transport = new SandboxStdioTransport(fake.handle, { maxBufferedBytes: 16 });
    const messages: JSONRPCMessage[] = [];
    transport.onmessage = (message) => messages.push(message);
    transport.onerror = (error) => fake.errors.push(error);
    await transport.start();

    fake.emitStdout('{"jsonrpc":"2.0","id":1,"result":{}}'); // kein newline
    await flush();
    fake.emitStdout("x".repeat(64));

    expect(fake.handle.kill).toHaveBeenCalledTimes(1);
    expect(fake.errors[0]?.message).toContain("buffer");
    expect(messages).toHaveLength(0); // kein halbes Frame wurde zugestellt
    expect(MCP_STDIO_MAX_BUFFERED_BYTES).toBe(4 * 1024 * 1024);
  });

  it("delivers complete stdout frames as they arrive, split at newlines", async () => {
    const fake = fakeSandboxProcess();
    const transport = new SandboxStdioTransport(fake.handle);
    const messages: JSONRPCMessage[] = [];
    transport.onmessage = (message) => messages.push(message);
    await transport.start();

    // One event carrying a tail-to-tail pair of frames, the split must produce both.
    fake.emitStdout('{"jsonrpc":"2.0","id":1,"result":{}}\n{"jsonrpc":"2.0","id":2,"result":{}}\n');
    await flush();
    expect(messages).toHaveLength(2);
    await transport.close();
  });

  it("serializes sends: one writer per process, frames in call order", async () => {
    const fake = fakeSandboxProcess();
    const transport = new SandboxStdioTransport(fake.handle);
    let ackFirst: (() => void) | undefined;
    const firstFrame = new Promise<void>((resolve) => {
      ackFirst = resolve;
    });
    const started: string[] = [];
    fake.handle.write = vi.fn(async (line: string) => {
      started.push(line);
      // Spec 4.2: exactly one writer per process — the second POST may not even
      // begin until the first one is acknowledged.
      if (started.length === 1) await firstFrame;
    });
    await transport.start();

    const a: JSONRPCMessage = { jsonrpc: "2.0", id: 1, method: "initialize" };
    const b: JSONRPCMessage = { jsonrpc: "2.0", id: 2, method: "tools/list" };
    const firstSend = transport.send(a);
    const secondSend = transport.send(b);
    await flush();
    expect(started).toHaveLength(1);
    ackFirst?.();
    await firstSend;
    await secondSend;
    expect(started).toEqual([`${JSON.stringify(a)}\n`, `${JSON.stringify(b)}\n`]);
    await transport.close();
  });

  it("a stdin rejection reaches the caller as a dead process, never retried", async () => {
    const fake = fakeSandboxProcess();
    const transport = new SandboxStdioTransport(fake.handle);
    transport.onerror = (error) => fake.errors.push(error);
    let writes = 0;
    fake.handle.write = vi.fn(async () => {
      writes += 1;
      throw new Error("sandbox process proc-fake rejected a stdin frame: 409");
    });
    await transport.start();

    await expect(transport.send({ jsonrpc: "2.0", id: 1, method: "ping" })).rejects.toThrow("409");
    expect(writes).toBe(1); // no silent retry
    expect(fake.errors[0]?.message).toContain("409");
    await transport.close();
  });

  it("a stdout frame that is not valid JSON is a protocol error, not a guess or a drop", async () => {
    const fake = fakeSandboxProcess();
    const transport = new SandboxStdioTransport(fake.handle);
    const messages: JSONRPCMessage[] = [];
    transport.onmessage = (message) => messages.push(message);
    transport.onerror = (error) => fake.errors.push(error);
    await transport.start();

    fake.emitStdout("this is not json\n");
    await flush();
    expect(fake.errors[0]?.message).toContain("JSON");
    expect(fake.handle.kill).toHaveBeenCalledTimes(1);
    expect(messages).toHaveLength(0);
  });

  it("trims stderr while it arrives and flags the truncation on the failure message", async () => {
    const fake = fakeSandboxProcess();
    const transport = new SandboxStdioTransport(fake.handle, { maxStderrBytes: 8 });
    transport.onerror = (error) => fake.errors.push(error);
    await transport.start();

    fake.emitStderr("npm ERR! something broke\n");
    await flush();
    fake.emitExit(1);
    await flush();

    const message = fake.errors[0]?.message ?? "";
    expect(message).toContain("exited with code 1");
    expect(message).toContain("npm"); // the kept head of stderr is still reported
    expect(message).toContain("truncated"); // and visibly marked as trimmed
  });

  it("a non-zero exit closes visibly with onerror and onclose", async () => {
    const fake = fakeSandboxProcess();
    const transport = new SandboxStdioTransport(fake.handle);
    transport.onerror = (error) => fake.errors.push(error);
    let closes = 0;
    transport.onclose = () => {
      closes += 1;
    };
    await transport.start();

    fake.emitExit(3);
    await flush();
    expect(fake.errors[0]?.message).toContain("3");
    expect(closes).toBe(1);
    await transport.close(); // the process already ended — nothing to kill a second time
    expect(fake.handle.kill).not.toHaveBeenCalled();
  });

  it("a zero exit closes with onclose only", async () => {
    const fake = fakeSandboxProcess();
    const transport = new SandboxStdioTransport(fake.handle);
    transport.onerror = (error) => fake.errors.push(error);
    let closes = 0;
    transport.onclose = () => {
      closes += 1;
    };
    await transport.start();

    fake.emitExit(0);
    await flush();
    expect(fake.errors).toHaveLength(0);
    expect(closes).toBe(1);
  });

  it("close is idempotent, kills a live process once, and later events arrive in the void", async () => {
    const fake = fakeSandboxProcess();
    const transport = new SandboxStdioTransport(fake.handle);
    const messages: JSONRPCMessage[] = [];
    transport.onmessage = (message) => messages.push(message);
    await transport.start();

    fake.emitStdout('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    await flush();
    expect(messages).toHaveLength(1);

    await transport.close();
    await transport.close();
    expect(fake.handle.kill).toHaveBeenCalledTimes(1);

    fake.emitStdout('{"jsonrpc":"2.0","id":2,"result":{}}\n');
    await flush();
    expect(messages).toHaveLength(1); // nach close() keine Zustellung mehr
  });
});
