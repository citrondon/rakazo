import { describe, expect, it, vi } from "vitest";
import {
  deliverWebhookEvent,
  type WebhookDeps,
  type WebhookTrustPlanner,
} from "./webhook-inbound.js";

function depsFor(trust?: WebhookTrustPlanner) {
  const sendUserMessage = vi.fn(async () => ({ messageId: "msg-1", runId: "run-1", seq: 1 }));
  const holdRunForChoice = vi.fn(async () => true);
  const enqueue = vi.fn(async () => undefined);
  const deps: Pick<WebhookDeps, "events" | "jobs" | "trust"> = {
    events: { sendUserMessage, holdRunForChoice },
    jobs: { enqueue },
    ...(trust ? { trust } : {}),
  };
  return { deps, sendUserMessage, holdRunForChoice, enqueue };
}

const target = {
  bot: { id: "bot-1", spaceId: "ws-1", userId: "user-1" },
  threadId: "thread-1",
};

describe("deliverWebhookEvent trust plan", () => {
  it("enqueues and never holds when no trust planner is configured", async () => {
    const { deps, sendUserMessage, holdRunForChoice, enqueue } = depsFor();

    await deliverWebhookEvent(deps, target, { prompt: "hi", routines: [], source: "webhook" });

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(sendUserMessage.mock.calls[0]![0]).not.toHaveProperty("trustPhase");
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(holdRunForChoice).not.toHaveBeenCalled();
  });

  it("records the planned phase and schedules the run", async () => {
    const { deps, sendUserMessage, enqueue, holdRunForChoice } = depsFor(async () => ({
      phase: "planned",
      paused: false,
    }));

    await deliverWebhookEvent(deps, target, { prompt: "hi", routines: [], source: "webhook" });

    expect(sendUserMessage.mock.calls[0]![0]).toMatchObject({ trustPhase: "planned" });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(holdRunForChoice).not.toHaveBeenCalled();
  });

  it("holds a paused run on a choice ask and never schedules it", async () => {
    const { deps, holdRunForChoice, enqueue } = depsFor(async () => ({
      phase: "paused",
      paused: true,
    }));

    await deliverWebhookEvent(deps, target, { prompt: "hi", routines: [], source: "webhook" });

    expect(holdRunForChoice).toHaveBeenCalledTimes(1);
    const held = holdRunForChoice.mock.calls[0]![0] as {
      spaceId: string;
      threadId: string;
      botId: string;
      runId: string;
      blocks: Array<{ kind: string }>;
      offeredActions: Array<{ id: string; label: string }>;
    };
    expect(held).toMatchObject({
      spaceId: "ws-1",
      threadId: "thread-1",
      botId: "bot-1",
      runId: "run-1",
      offeredActions: [{ id: "run", label: "Run now" }],
    });
    expect(held.blocks[0]!.kind).toBe("ask");
    expect(enqueue).not.toHaveBeenCalled();
  });
});
