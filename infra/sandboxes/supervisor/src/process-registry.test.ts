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
    expect(registry.get("p1")).toBeUndefined(); // no process yet, only the reservation
    reserved.attach(handleExit(0) as never);
    expect(registry.get("p1")?.id).toBe("p1");
  });

  it("kills a handle that arrives after its reservation was already released", async () => {
    // The race from spec 4.1: the DELETE lands between the start and the attach.
    const registry = createProcessRegistry();
    const reserved = registry.reserve({ id: "race", computerId: "c1", botId: "b1" });
    await registry.release("race", "operator", "closed during start");
    const handle = handleExit(0);
    reserved.attach(handle as never);
    expect(registry.get("race")).toBeUndefined();
    expect(handle.kill).toHaveBeenCalledTimes(1);
  });

  it("removes the reservation when the start itself fails", () => {
    const registry = createProcessRegistry();
    const reserved = registry.reserve({ id: "failed", computerId: "c1", botId: "b1" });
    reserved.abort();
    expect(registry.get("failed")).toBeUndefined();
  });

  it("releases only for the reader that attached", async () => {
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry.reserve({ id: "p2", computerId: "c1", botId: "b1" }).attach(handle as never);
    registry.get("p2")!.attachReader("reader-a", () => {});
    await registry.release("p2", "reader-stale", "gone");
    expect(registry.get("p2")).toBeDefined();
    await registry.release("p2", "reader-a", "client disconnected");
    expect(registry.get("p2")).toBeUndefined();
    expect(handle.kill).toHaveBeenCalledTimes(1);
  });

  it("lets a displaced reader go away without dropping the new one", async () => {
    // Der Fall, den openbots viewer.ts:202-213 mit Identitätsvergleich löst.
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry.reserve({ id: "swap", computerId: "c1", botId: "b1" }).attach(handle as never);
    const detachFirst = registry.get("swap")!.attachReader("reader-a", () => {});
    registry.get("swap")!.attachReader("reader-b", () => {});
    detachFirst();
    await registry.release("swap", "reader-a", "stale detach");
    expect(registry.get("swap")).toBeDefined();
    expect(handle.kill).not.toHaveBeenCalled();
    await registry.release("swap", "reader-b", "client disconnected");
    expect(registry.get("swap")).toBeUndefined();
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
    const detachStale = registry.get("flow")!.attachReader("reader-a", (e) => stale.push(e));
    detachStale();
    registry.get("flow")!.attachReader("reader-b", (e) => current.push(e));

    handle.emitOutput({ stream: "stdout", data: "{}\n" });
    handle.exit(7);
    await new Promise((resolve) => setImmediate(resolve));

    expect(stale).toEqual([]);
    expect(current).toEqual([
      { type: "stdout", data: "{}\n" },
      { type: "exit", code: 7 },
    ]);
    expect(registry.get("flow")).toBeUndefined();
  });

  it("drops the entry when the process exits on its own", async () => {
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry.reserve({ id: "p3", computerId: "c1", botId: "b1" }).attach(handle as never);
    handle.exit(0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(registry.get("p3")).toBeUndefined();
  });

  it("settles a torn stream instead of leaving the reader waiting", async () => {
    // done rejects when the hijack tears: without a handler the supervisor would go down.
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry.reserve({ id: "torn", computerId: "c1", botId: "b1" }).attach(handle as never);
    const events: ProcessEventLike[] = [];
    registry.get("torn")!.attachReader("reader-a", (e) => events.push(e));
    handle.fail();
    await new Promise((resolve) => setImmediate(resolve));
    expect(registry.get("torn")).toBeUndefined();
    expect(events).toEqual([{ type: "stderr", data: "process stream lost\n" }]);
  });
});
