import { describe, it, expect } from "vitest";
import { DelegationQueue } from "./queue.js";
import { DelegationRequestSchema } from "@rakazo/contracts";

describe("DelegationQueue", () => {
  it("enqueues and assigns", async () => {
    const q = new DelegationQueue();
    const req = DelegationRequestSchema.parse({ missionId: "m", sliceId: "s", roleId: "r", acceptanceCriteria: ["ok"] });
    const entry = await q.enqueue(req);
    expect(entry.status).toBe("pending");
    const assigned = await q.assign(entry.id, "bot-123", "/tmp/worktree");
    expect(assigned.status).toBe("assigned");
    expect(assigned.assignedBotId).toBe("bot-123");
    expect(assigned.worktreePath).toBe("/tmp/worktree");
  });

  it("starts assigned entry", async () => {
    const q = new DelegationQueue();
    const req = DelegationRequestSchema.parse({ missionId: "m", sliceId: "s", roleId: "r", acceptanceCriteria: ["ok"] });
    const entry = await q.enqueue(req);
    await q.assign(entry.id, "bot-123", "/tmp/wt");
    const started = await q.start(entry.id);
    expect(started.status).toBe("running");
  });

  it("completes with success result", async () => {
    const q = new DelegationQueue();
    const req = DelegationRequestSchema.parse({ missionId: "m", sliceId: "s", roleId: "r", acceptanceCriteria: ["ok"] });
    const entry = await q.enqueue(req);
    await q.assign(entry.id, "bot-123", "/tmp/wt");
    await q.start(entry.id);
    const done = await q.complete(entry.id, { success: true, artifacts: ["a.ts"], logs: ["done"] });
    expect(done.status).toBe("done");
    expect(done.result?.success).toBe(true);
    expect(done.result?.artifacts).toHaveLength(1);
  });

  it("completes with failure result", async () => {
    const q = new DelegationQueue();
    const req = DelegationRequestSchema.parse({ missionId: "m", sliceId: "s", roleId: "r", acceptanceCriteria: ["ok"] });
    const entry = await q.enqueue(req);
    await q.assign(entry.id, "bot-123", "/tmp/wt");
    await q.start(entry.id);
    const failed = await q.complete(entry.id, { success: false, artifacts: [], logs: ["error"], error: "TypeError" });
    expect(failed.status).toBe("failed");
    expect(failed.result?.success).toBe(false);
    expect(failed.result?.error).toBe("TypeError");
  });

  it("blocks entry with reason", async () => {
    const q = new DelegationQueue();
    const req = DelegationRequestSchema.parse({ missionId: "m", sliceId: "s", roleId: "r", acceptanceCriteria: ["ok"] });
    const entry = await q.enqueue(req);
    const blocked = await q.block(entry.id, "waiting for dependency");
    expect(blocked.status).toBe("blocked");
    expect(blocked.result?.error).toBe("waiting for dependency");
  });

  it("filters list by status and botId", async () => {
    const q = new DelegationQueue();
    const req = DelegationRequestSchema.parse({ missionId: "m", sliceId: "s", roleId: "r", acceptanceCriteria: ["ok"] });
    const e1 = await q.enqueue(req);
    const e2 = await q.enqueue(req);
    await q.assign(e1.id, "bot-1", "/wt1");
    await q.assign(e2.id, "bot-2", "/wt2");
    expect(q.list({ status: "assigned" })).toHaveLength(2);
    expect(q.list({ assignedBotId: "bot-1" })).toHaveLength(1);
    expect(q.list({ status: "assigned", assignedBotId: "bot-1" })).toHaveLength(1);
  });
});