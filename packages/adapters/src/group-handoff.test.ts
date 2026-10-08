import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { handoffToGroupBot } from "./group-handoff.js";

const run = {
  id: "run-a",
  spaceId: "workspace-1",
  threadId: "thread-1",
  botId: "bot-a",
  userId: "user-1",
};

function harness(
  sourceBlocks: unknown,
  existing?: { sourceRuns: { id: string; botId: string }[] },
) {
  const runCreate = vi.fn(async () => ({ id: "run-b" }));
  const messageCreate = vi.fn(async () => ({ id: "message-1" }));
  const taskCreate = vi.fn(async () => ({ id: "task-b" }));
  const eventCreate = vi.fn(async () => ({ seq: 1 }));
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: "group-1" }]),
    chatGroup: {
      findFirst: vi.fn(async () => ({
        id: "group-1",
        members: ["bot-a", "bot-b", "bot-c"].map((id) => ({
          bot: { id, name: id.toUpperCase() },
        })),
      })),
      update: vi.fn(async () => ({ id: "group-1" })),
    },
    run: {
      findFirst: vi.fn(async () => ({
        id: run.id,
        sourceMessage: { blocks: sourceBlocks },
      })),
      findUnique: vi.fn(async () => ({ status: "running" })),
      create: runCreate,
    },
    message: {
      findUnique: vi.fn(async () => existing ?? null),
      create: messageCreate,
    },
    thread: {
      update: vi.fn(async (args: { select: { nextMessageSeq?: boolean } }) =>
        args.select.nextMessageSeq ? { nextMessageSeq: 2 } : { nextEventSeq: 2 },
      ),
    },
    task: { create: taskCreate },
    event: {
      findFirst: vi.fn(async () => ({ seq: 1 })),
      create: eventCreate,
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaClient;
  return {
    deps: {
      prisma,
      events: { notify: vi.fn(async () => undefined) },
      jobs: { enqueue: vi.fn(async () => undefined) },
    },
    messageCreate,
    runCreate,
    taskCreate,
    eventCreate,
  };
}

describe("group handoff ownership", () => {
  it("marks a new ownership transfer as a follow-up with a chain hop", async () => {
    const { deps, messageCreate, runCreate } = harness([{ kind: "text", text: "user request" }]);

    await expect(
      handoffToGroupBot(deps as never, run, "group-1", {
        bot_id: "bot-b",
        message: "Do the distinct next stage",
      }),
    ).resolves.toMatchObject({ ok: true, botId: "bot-b" });

    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          blocks: [
            expect.objectContaining({
              kind: "handoff",
              fromBotId: "bot-a",
              toBotId: "bot-b",
              hop: 1,
            }),
          ],
        }),
      }),
    );
    expect(runCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ trigger: "follow_up" }) }),
    );
  });

  it("refuses to bounce a handed-off stage straight back to its sender", async () => {
    const { deps, runCreate } = harness([
      { kind: "handoff", fromBotId: "bot-b", toBotId: "bot-a", text: "Investigate", hop: 1 },
    ]);

    await expect(
      handoffToGroupBot(deps as never, run, "group-1", {
        bot_id: "bot-b",
        message: "You investigate it",
      }),
    ).resolves.toEqual({
      error:
        "Do not hand this stage back to its sender; post the result in the shared thread instead.",
    });
    expect(runCreate).not.toHaveBeenCalled();
  });

  it("caps longer multi-agent handoff chains", async () => {
    const { deps, runCreate } = harness([
      { kind: "handoff", fromBotId: "bot-b", toBotId: "bot-a", text: "Stage six", hop: 6 },
    ]);

    await expect(
      handoffToGroupBot(deps as never, run, "group-1", {
        bot_id: "bot-c",
        message: "Stage seven",
      }),
    ).resolves.toEqual({
      error:
        "Group handoff limit reached for this chain; finish the current stage in the shared thread instead.",
    });
    expect(runCreate).not.toHaveBeenCalled();
  });

  it("reuses the recorded transfer when a source run is retried", async () => {
    const { deps, messageCreate, runCreate } = harness([], {
      sourceRuns: [{ id: "run-b", botId: "bot-b" }],
    });

    await expect(
      handoffToGroupBot(deps as never, run, "group-1", {
        bot_id: "bot-c",
        message: "A duplicate stage",
      }),
    ).resolves.toMatchObject({ ok: true, botId: "bot-b", runId: "run-b" });
    expect(messageCreate).not.toHaveBeenCalled();
    expect(runCreate).not.toHaveBeenCalled();
  });

  it("rejects malformed source ancestry instead of restarting its hop count", async () => {
    const { deps, runCreate } = harness({ kind: "not-an-array" });

    await expect(
      handoffToGroupBot(deps as never, run, "group-1", {
        bot_id: "bot-b",
        message: "Continue",
      }),
    ).resolves.toEqual({ error: "cannot verify the group handoff chain" });
    expect(runCreate).not.toHaveBeenCalled();
  });
});

describe("group handoff briefs", () => {
  it("carries the task, the constraints, and what counts as done", async () => {
    const { deps, messageCreate, taskCreate } = harness([{ kind: "text", text: "user request" }]);

    await expect(
      handoffToGroupBot(deps as never, run, "group-1", {
        bot_id: "bot-b",
        task: "Package the CLI",
        constraints: "Node 18.20.4, no new dependencies",
        acceptance: "node --test is green",
      }),
    ).resolves.toMatchObject({ ok: true, botId: "bot-b" });

    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          blocks: [
            expect.objectContaining({
              kind: "handoff",
              text: "Package the CLI",
              constraints: "Node 18.20.4, no new dependencies",
              acceptance: "node --test is green",
            }),
          ],
        }),
      }),
    );
    // The receiving bot has to be able to read the brief, not guess it.
    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          prompt: expect.stringContaining("Task: Package the CLI"),
        }),
      }),
    );
    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          prompt: expect.stringContaining("Constraints: Node 18.20.4, no new dependencies"),
        }),
      }),
    );
    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          prompt: expect.stringContaining("A good result: node --test is green"),
        }),
      }),
    );
  });

  it("leaves the optional fields off a brief that did not name them", async () => {
    const { deps, messageCreate } = harness([]);

    await expect(
      handoffToGroupBot(deps as never, run, "group-1", {
        bot_id: "bot-b",
        task: "Check the numbers",
      }),
    ).resolves.toMatchObject({ ok: true });

    const blocks = (
      messageCreate.mock.calls[0] as unknown as [{ data: { blocks: Record<string, unknown>[] } }]
    )[0].data.blocks;
    expect(blocks[0]).not.toHaveProperty("constraints");
    expect(blocks[0]).not.toHaveProperty("acceptance");
  });
});

describe("refused group handoffs", () => {
  it("says the same thing whether the bot is unknown or merely not a member", async () => {
    const unknown = harness([]);
    const notAMember = harness([]);

    const byName = await handoffToGroupBot(unknown.deps as never, run, "group-1", {
      confirm_name: "Nobody",
      task: "Do the next stage",
    });
    const byId = await handoffToGroupBot(notAMember.deps as never, run, "group-1", {
      bot_id: "bot-z",
      task: "Do the next stage",
    });

    // A roster must not become enumerable by probing for bots that exist.
    expect(byName).toEqual({ error: "That bot is not a member of this chat." });
    expect(byId).toEqual(byName);
  });

  it("asks for a target only when the caller named none", async () => {
    const none = harness([]);

    await expect(
      handoffToGroupBot(none.deps as never, run, "group-1", { task: "Do the next stage" }),
    ).resolves.toEqual({ error: "handoff target bot is required" });
    expect(none.messageCreate).not.toHaveBeenCalled();
    expect(none.eventCreate).not.toHaveBeenCalled();
  });

  it("writes the refusal into the chat and into the log", async () => {
    const { deps, messageCreate, eventCreate, runCreate } = harness([]);

    await expect(
      handoffToGroupBot(deps as never, run, "group-1", {
        bot_id: "bot-z",
        task: "Do the next stage",
      }),
    ).resolves.toEqual({ error: "That bot is not a member of this chat." });

    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "system",
          blocks: [
            {
              kind: "meta",
              text: "Handoff refused: the named bot is not a member of this chat.",
            },
          ],
        }),
      }),
    );
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "group.handoff_refused",
          payload: expect.objectContaining({ reason: "not-a-member", toBotId: "bot-z" }),
        }),
      }),
    );
    expect(runCreate).not.toHaveBeenCalled();
  });

  it("records a refused hand-back as well", async () => {
    const { deps, eventCreate } = harness([
      { kind: "handoff", fromBotId: "bot-b", toBotId: "bot-a", text: "Investigate", hop: 1 },
    ]);

    await expect(
      handoffToGroupBot(deps as never, run, "group-1", {
        bot_id: "bot-b",
        task: "You investigate it",
      }),
    ).resolves.toEqual({
      error:
        "Do not hand this stage back to its sender; post the result in the shared thread instead.",
    });
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "group.handoff_refused",
          payload: expect.objectContaining({ reason: "hand-back" }),
        }),
      }),
    );
  });

  it("refuses a handoff with no task before it touches the database", async () => {
    const { deps, messageCreate, runCreate } = harness([]);

    await expect(
      handoffToGroupBot(deps as never, run, "group-1", { bot_id: "bot-b" }),
    ).resolves.toEqual({ ok: false, error: "a handoff needs a task" });
    expect(messageCreate).not.toHaveBeenCalled();
    expect(runCreate).not.toHaveBeenCalled();
  });
});
