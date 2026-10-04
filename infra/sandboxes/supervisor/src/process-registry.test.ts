import { describe, expect, it, vi } from "vitest";
import type { ProcessEventLike } from "./process-registry.js";
import { createProcessRegistry, MCP_PROCESS_IDLE_MS } from "./process-registry.js";

function handleExit(_code: number) {
  let resolveDone!: (value: { code: number }) => void;
  let rejectDone!: (error: Error) => void;
  let output: ((chunk: { stream: "stdout" | "stderr"; data: string }) => void) | undefined;
  return {
    write: vi.fn(async () => {}),
    onOutput: vi.fn((listener: typeof output) => {
      output = listener;
    }),
    kill: vi.fn(async () => {}),
    done: new Promise<{ code: number }>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    }),
    exit: (exitCode: number) => resolveDone({ code: exitCode }),
    fail: () => rejectDone(new Error("stream torn")),
    emitOutput: (chunk: { stream: "stdout" | "stderr"; data: string }) => output?.(chunk),
  };
}

describe("process registry", () => {
  it("reserves without awaiting, so a close during start still has something to release", () => {
    const registry = createProcessRegistry();
    const reserved = registry.reserve({ id: "p1", computerId: "c1", botId: "b1" });
    expect(registry.get("p1", "c1", "b1")).toBeUndefined(); // no process yet, only the reservation
    reserved.attach(handleExit(0) as never);
    expect(registry.get("p1", "c1", "b1")?.id).toBe("p1");
  });

  it("kills a handle that arrives after its reservation was already released", async () => {
    // The race from spec 4.1: the DELETE lands between the start and the attach.
    const registry = createProcessRegistry();
    const reserved = registry.reserve({ id: "race", computerId: "c1", botId: "b1" });
    await registry.release("race", "operator", "closed during start");
    const handle = handleExit(0);
    reserved.attach(handle as never);
    expect(registry.get("race", "c1", "b1")).toBeUndefined();
    expect(handle.kill).toHaveBeenCalledTimes(1);
  });

  it("removes the reservation when the start itself fails", () => {
    const registry = createProcessRegistry();
    const reserved = registry.reserve({ id: "failed", computerId: "c1", botId: "b1" });
    reserved.abort();
    expect(registry.get("failed", "c1", "b1")).toBeUndefined();
  });

  it("releases only for the reader that attached", async () => {
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry.reserve({ id: "p2", computerId: "c1", botId: "b1" }).attach(handle as never);
    registry.get("p2", "c1", "b1")!.attachReader("reader-a", () => {});
    await registry.release("p2", "reader-stale", "gone");
    expect(registry.get("p2", "c1", "b1")).toBeDefined();
    await registry.release("p2", "reader-a", "client disconnected");
    expect(registry.get("p2", "c1", "b1")).toBeUndefined();
    expect(handle.kill).toHaveBeenCalledTimes(1);
  });

  it("lets a displaced reader go away without dropping the new one", async () => {
    // The case openbots viewer.ts:202-213 resolves with an identity comparison.
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry.reserve({ id: "swap", computerId: "c1", botId: "b1" }).attach(handle as never);
    const detachFirst = registry.get("swap", "c1", "b1")!.attachReader("reader-a", () => {});
    registry.get("swap", "c1", "b1")!.attachReader("reader-b", () => {});
    detachFirst();
    await registry.release("swap", "reader-a", "stale detach");
    expect(registry.get("swap", "c1", "b1")).toBeDefined();
    expect(handle.kill).not.toHaveBeenCalled();
    await registry.release("swap", "reader-b", "client disconnected");
    expect(registry.get("swap", "c1", "b1")).toBeUndefined();
    expect(handle.kill).toHaveBeenCalledTimes(1);
  });

  it("idle sweeps kill exactly the expired process", async () => {
    const registry = createProcessRegistry({ idleMs: 10 });
    const expired = handleExit(0);
    const fresh = handleExit(0);
    registry.reserve({ id: "old", computerId: "c1", botId: "b1" }).attach(expired as never);
    await new Promise((resolve) => setTimeout(resolve, 20));
    registry.reserve({ id: "new", computerId: "c1", botId: "b1" }).attach(fresh as never);
    expect(await registry.sweep()).toEqual(["old"]);
    expect(expired.kill).toHaveBeenCalledTimes(1);
    expect(fresh.kill).not.toHaveBeenCalled();
  });

  it("keeps the documented idle window below the ten minute suspension", () => {
    expect(MCP_PROCESS_IDLE_MS).toBeLessThan(600_000);
  });

  it("routes output to the current reader and ends with exit", async () => {
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry.reserve({ id: "flow", computerId: "c1", botId: "b1" }).attach(handle as never);
    const stale: ProcessEventLike[] = [];
    const current: ProcessEventLike[] = [];
    const detachStale = registry
      .get("flow", "c1", "b1")!
      .attachReader("reader-a", (e) => stale.push(e));
    detachStale();
    registry.get("flow", "c1", "b1")!.attachReader("reader-b", (e) => current.push(e));

    handle.emitOutput({ stream: "stdout", data: "{}\n" });
    handle.exit(7);
    await new Promise((resolve) => setImmediate(resolve));

    expect(stale).toEqual([]);
    expect(current).toEqual([
      { type: "stdout", data: "{}\n" },
      { type: "exit", code: 7 },
    ]);
    expect(registry.get("flow", "c1", "b1")).toBeUndefined();
  });

  it("drops the entry when the process exits on its own", async () => {
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry.reserve({ id: "p3", computerId: "c1", botId: "b1" }).attach(handle as never);
    handle.exit(0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(registry.get("p3", "c1", "b1")).toBeUndefined();
  });

  it("settles a torn stream instead of leaving the reader waiting", async () => {
    // done rejects when the hijack tears: without a handler the supervisor would go down.
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry.reserve({ id: "torn", computerId: "c1", botId: "b1" }).attach(handle as never);
    const events: ProcessEventLike[] = [];
    registry.get("torn", "c1", "b1")!.attachReader("reader-a", (e) => events.push(e));
    handle.fail();
    await new Promise((resolve) => setImmediate(resolve));
    // A torn stream is not an exit: the child is likely still alive, so it is killed before the
    // entry is forgotten, or the process would run on until the ten minute suspension caps it.
    expect(handle.kill).toHaveBeenCalledTimes(1);
    expect(registry.get("torn", "c1", "b1")).toBeUndefined();
    // Spec 4.1: the event stream ends with exit — an unknown outcome surfaces as code 1.
    expect(events).toEqual([
      { type: "stderr", data: "process stream lost\n" },
      { type: "exit", code: 1 },
    ]);
  });

  it("answers only the owning computer and bot on the channel", () => {
    // The route identity check the stored computerId and botId exist for: a processId must
    // never open a window into another computer's process.
    const registry = createProcessRegistry();
    registry.reserve({ id: "owned", computerId: "c1", botId: "b1" }).attach(handleExit(0) as never);
    expect(registry.get("owned", "c2", "b1")).toBeUndefined();
    expect(registry.get("owned", "c1", "b2")).toBeUndefined();
    expect(registry.get("owned", "c1", "b1")).toBeDefined();
  });

  it("ends a process terminally and marks it ended only for its owner", async () => {
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry.reserve({ id: "ended", computerId: "c1", botId: "b1" }).attach(handle as never);
    await registry.release("ended", "operator", "operator requested it");
    expect(registry.get("ended", "c1", "b1")).toBeUndefined();
    expect(registry.wasEnded("ended", "c1", "b1")).toBe(true);
    // The marker is owner-scoped exactly like the live entry.
    expect(registry.wasEnded("ended", "c2", "b1")).toBe(false);
    expect(registry.wasEnded("ended", "c1", "b2")).toBe(false);
    // Terminal: a second release kills nothing a second time.
    await registry.release("ended", "operator", "again");
    expect(handle.kill).toHaveBeenCalledTimes(1);
  });

  it("kills a handle that attaches after the process already exited instead of resurrecting it", async () => {
    // attach must be terminal for an ended entry: the late handle has no owner again.
    const registry = createProcessRegistry();
    const first = handleExit(0);
    const reserved = registry.reserve({ id: "dead", computerId: "c1", botId: "b1" });
    reserved.attach(first as never);
    first.exit(7);
    await new Promise((resolve) => setImmediate(resolve));
    expect(registry.get("dead", "c1", "b1")).toBeUndefined();
    expect(registry.wasEnded("dead", "c1", "b1")).toBe(true);
    const late = handleExit(0);
    expect(reserved.attach(late as never)).toBeUndefined();
    expect(late.kill).toHaveBeenCalledTimes(1);
    expect(registry.wasEnded("dead", "c1", "b1")).toBe(true);
  });

  it("forgets ended markers once they pass the idle window", async () => {
    const registry = createProcessRegistry({ idleMs: 10 });
    const handle = handleExit(0);
    registry.reserve({ id: "marker", computerId: "c1", botId: "b1" }).attach(handle as never);
    handle.exit(0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(registry.wasEnded("marker", "c1", "b1")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await registry.sweep()).toEqual([]);
    expect(registry.wasEnded("marker", "c1", "b1")).toBe(false);
  });

  it("ends a reading channel with the killed exit code when the process is dropped", async () => {
    // drop() must terminate the reader's stream: the killed child resolves as SIGTERM.
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry.reserve({ id: "gone", computerId: "c1", botId: "b1" }).attach(handle as never);
    const events: ProcessEventLike[] = [];
    registry.get("gone", "c1", "b1")!.attachReader("reader-a", (e) => events.push(e));
    await registry.release("gone", "reader-a", "operator requested it");
    expect(events).toEqual([
      { type: "stderr", data: "process closed: operator requested it\n" },
      { type: "exit", code: 143 },
    ]);
  });

  it("swallows a kill failure on the torn-stream path instead of leaving an unhandled rejection", async () => {
    // The best-effort kill here is fire-and-forget; a rejecting Docker kill must not reach the host.
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    handle.kill = vi.fn(async () => {
      throw new Error("docker api down");
    });
    registry.reserve({ id: "torn-kill", computerId: "c1", botId: "b1" }).attach(handle as never);
    handle.fail();
    await new Promise((resolve) => setImmediate(resolve));
    expect(handle.kill).toHaveBeenCalledTimes(1);
    expect(registry.get("torn-kill", "c1", "b1")).toBeUndefined();
  });

  it("catches and logs a late-attach kill rejection instead of crashing the host", async () => {
    // runKill is a Docker call and can reject; an uncaught fire-and-forget reject would take the
    // supervisor down under --unhandled-rejections=throw, so it is caught and logged best-effort.
    const warnings: string[] = [];
    const registry = createProcessRegistry({
      logger: { warn: (message) => warnings.push(message) },
    });
    const reserved = registry.reserve({ id: "late", computerId: "c1", botId: "b1" });
    await registry.release("late", "operator", "closed during start");
    const handle = handleExit(0);
    handle.kill = vi.fn(async () => {
      throw new Error("docker api down");
    });
    expect(reserved.attach(handle as never)).toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));
    expect(handle.kill).toHaveBeenCalledTimes(1);
    expect(warnings).toEqual(["supervisor process kill failed after late attach"]);
  });
});
