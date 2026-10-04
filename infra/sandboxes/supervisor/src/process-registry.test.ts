import { describe, expect, it, vi } from "vitest";
import { createProcessRegistry, MCP_PROCESS_IDLE_MS } from "./process-registry.js";

function handleExit(_code: number) {
  let resolveDone!: (value: { code: number }) => void;
  return {
    write: vi.fn(async () => {}),
    onOutput: vi.fn(),
    kill: vi.fn(async () => {}),
    done: new Promise<{ code: number }>((resolve) => {
      resolveDone = resolve;
    }),
    exit: (exitCode: number) => resolveDone({ code: exitCode }),
  };
}

describe("process registry", () => {
  it("registers without awaiting, so a close during start still has something to release", () => {
    const registry = createProcessRegistry();
    const claimed = registry.claim({
      id: "p1",
      computerId: "c1",
      botId: "b1",
      handle: handleExit(0) as never,
    });
    expect(registry.get("p1")).toBe(claimed);
  });

  it("releases only for the reader that attached", async () => {
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry.claim({ id: "p2", computerId: "c1", botId: "b1", handle: handle as never });
    const detach = registry.get("p2")!.attachReader("reader-a", () => {});
    await registry.release("p2", "reader-stale", "gone");
    expect(registry.get("p2")).toBeDefined();
    detach();
    await registry.release("p2", "reader-a", "client disconnected");
    expect(registry.get("p2")).toBeUndefined();
    expect(handle.kill).toHaveBeenCalledTimes(1);
  });

  it("idle sweeps kill exactly the expired process", async () => {
    const registry = createProcessRegistry({ idleMs: 10 });
    const expired = handleExit(0);
    const fresh = handleExit(0);
    registry.claim({ id: "old", computerId: "c1", botId: "b1", handle: expired as never });
    await new Promise((resolve) => setTimeout(resolve, 20));
    registry.claim({ id: "new", computerId: "c1", botId: "b1", handle: fresh as never });
    expect(await registry.sweep()).toEqual(["old"]);
    expect(expired.kill).toHaveBeenCalledTimes(1);
    expect(fresh.kill).not.toHaveBeenCalled();
  });

  it("keeps the documented idle window below the ten minute suspension", () => {
    expect(MCP_PROCESS_IDLE_MS).toBeLessThan(600_000);
  });

  it("drops the entry when the process exits on its own", async () => {
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry.claim({ id: "p3", computerId: "c1", botId: "b1", handle: handle as never });
    handle.exit(0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(registry.get("p3")).toBeUndefined();
  });
});
