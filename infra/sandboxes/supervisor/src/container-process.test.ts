import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { startContainerProcess } from "./container-process.js";

/** Mirrors a docker hijack stream: writes go to stdin, reads arrive independently. */
class FakeDuplex extends EventEmitter {
  readonly written: Buffer[] = [];
  destroyed = false;

  write(chunk: Buffer | string, callback?: (error?: Error | null) => void) {
    this.written.push(Buffer.from(chunk));
    callback?.();
    return true;
  }

  destroy() {
    this.destroyed = true;
  }

  pushOutput(data: Buffer) {
    this.emit("data", data);
  }

  finish() {
    this.emit("end");
  }
}

function frame(channel: number, text: string) {
  const header = Buffer.alloc(8);
  header[0] = channel;
  header.writeUInt32BE(text.length, 4);
  return Buffer.concat([header, Buffer.from(text)]);
}

function fakeContainer() {
  const stream = new FakeDuplex();
  const exec = {
    start: vi.fn(async () => stream),
    inspect: vi.fn(async () => ({ ExitCode: 3 })),
  };
  const container = { exec: vi.fn(async () => exec) };
  return { container, exec, stream };
}

describe("startContainerProcess", () => {
  it("exposes stdin, demuxed output and the exit code without waiting for the stream to end", async () => {
    const { container, exec, stream } = fakeContainer();
    const seen: Array<{ stream: string; data: string }> = [];
    const handle = await startContainerProcess(container as never, ["node", "server.js"], {
      workingDir: "/home/rakazo",
      env: ["HOME=/home/rakazo"],
      runKill: async () => undefined,
    });
    handle.onOutput((chunk) => seen.push(chunk));

    // Raw docker frame multiplex: stdout channel 1, stderr channel 2, 8-byte header.
    stream.pushOutput(frame(1, "ready\n"));
    stream.pushOutput(frame(2, "warn\n"));

    await handle.write('{"jsonrpc":"2.0"}\n');
    expect(stream.written[0]).toEqual(Buffer.from('{"jsonrpc":"2.0"}\n'));

    const done = handle.done;
    stream.finish();
    await expect(done).resolves.toEqual({ code: 3 });
    expect(exec.start).toHaveBeenCalledWith({ hijack: true, stdin: true });
    expect(seen).toEqual([
      { stream: "stdout", data: "ready\n" },
      { stream: "stderr", data: "warn\n" },
    ]);
  });

  it("kills through the injected command and destroys the stream", async () => {
    const { container, stream } = fakeContainer();
    const runKill = vi.fn(async () => undefined);
    const handle = await startContainerProcess(container as never, ["node", "server.js"], {
      runKill,
    });
    await handle.kill();
    expect(runKill).toHaveBeenCalledTimes(1);
    expect(stream.destroyed).toBe(true);
  });
});
