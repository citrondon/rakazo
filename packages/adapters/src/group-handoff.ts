import { runContinueJob } from "@rakazo/adapter-kit";
import { MessageBlock } from "@rakazo/contracts";
import {
  botMessageHopExhausted,
  buildHandoffWakePrompt,
  HANDOFF_REFUSALS,
  type HandoffRefusalReason,
  nextBotMessageHop,
  normalizeHandoffBrief,
  renderGroupMembersContext,
} from "@rakazo/core";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  IsolationError,
  lockOwnedGroup,
  type PrismaClient,
  touchGroupUpdatedAt,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import type { ExecutorDeps } from "./executor.js";

export async function handoffToGroupBot(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs">,
  run: {
    id: string;
    spaceId: string;
    threadId: string;
    botId: string;
    userId: string;
  },
  groupId: string,
  input: {
    bot_id?: string;
    confirm_name?: string;
    task?: string;
    constraints?: string;
    acceptance?: string;
    /** Accepted alias for `task`. */
    message?: string;
  },
) {
  const normalized = normalizeHandoffBrief(input);
  if (!normalized.ok) return normalized;
  const brief = normalized.brief;
  const deliveryKey = `group-handoff:${run.id}`;
  const committed = await deps.prisma.$transaction(async (tx) => {
    try {
      await lockOwnedGroup(tx, run, groupId);
    } catch (error) {
      if (error instanceof IsolationError)
        return { error: HANDOFF_REFUSALS["group-unavailable"].error } as const;
      throw error;
    }
    const [group, activeSource] = await Promise.all([
      tx.chatGroup.findFirst({
        where: { id: groupId, archivedAt: null, thread: { id: run.threadId } },
        include: {
          members: {
            where: { bot: { archivedAt: null } },
            include: { bot: { select: { id: true, name: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
      }),
      tx.run.findFirst({
        where: {
          id: run.id,
          spaceId: run.spaceId,
          threadId: run.threadId,
          botId: run.botId,
          userId: run.userId,
          status: "running",
        },
        select: { id: true, sourceMessage: { select: { blocks: true } } },
      }),
    ]);
    if (!group || !activeSource) return { error: "source run is no longer active" } as const;

    /**
     * A refused handoff is a policy answer, not a failed tool call: the caller
     * gets the reason, and the chat plus the event log get a record of it. A
     * stage that never moved has to be distinguishable from one that is slow.
     */
    const refuse = async (reason: HandoffRefusalReason, toBotId?: string) => {
      const { error, note } = HANDOFF_REFUSALS[reason];
      await createThreadMessageInTransaction(tx, {
        threadId: run.threadId,
        role: "system",
        blocks: [{ kind: "meta", text: note }],
        botId: run.botId,
        runId: run.id,
      });
      await appendEventInTransaction(tx, {
        spaceId: run.spaceId,
        threadId: run.threadId,
        botId: run.botId,
        type: "group.handoff_refused",
        runId: run.id,
        payload: { reason, fromBotId: run.botId, toBotId, error },
      });
      return { error } as const;
    };

    const sender = group.members.find((member) => member.bot.id === run.botId);
    if (!sender) return refuse("sender-not-a-member");

    const existing = await tx.message.findUnique({
      where: { threadId_clientNonce: { threadId: run.threadId, clientNonce: deliveryKey } },
      select: {
        sourceRuns: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { id: true, botId: true },
        },
      },
    });
    if (existing) {
      const nextRun = existing.sourceRuns[0];
      const event = await tx.event.findFirst({
        where: { threadId: run.threadId, runId: run.id, type: "group.handoff" },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });
      if (!nextRun || !event) return { error: "recorded handoff is incomplete" } as const;
      return { ok: true, botId: nextRun.botId, runId: nextRun.id, eventSeq: event.seq } as const;
    }

    let targetId = input.bot_id?.trim();
    if (!targetId && input.confirm_name?.trim()) {
      const name = input.confirm_name.trim().toLowerCase();
      const named = group.members.find((member) => member.bot.name.toLowerCase() === name);
      // A bot the caller named but this chat does not hold gets the same
      // refusal as an id that is not a member: the answer must not say which
      // bots exist elsewhere.
      if (!named) return refuse("not-a-member");
      targetId = named.bot.id;
    }
    if (!targetId) return { error: "handoff target bot is required" } as const;
    if (targetId === run.botId) return { error: "cannot hand off to yourself" } as const;
    if (!group.members.some((member) => member.bot.id === targetId)) {
      return refuse("not-a-member", targetId);
    }

    let sourceBlocks: MessageBlock[] = [];
    if (activeSource.sourceMessage) {
      const parsedSource = MessageBlock.array().safeParse(activeSource.sourceMessage.blocks);
      if (!parsedSource.success) {
        return { error: "cannot verify the group handoff chain" } as const;
      }
      sourceBlocks = parsedSource.data;
    }
    const sourceHandoff = sourceBlocks.find(
      (block): block is Extract<MessageBlock, { kind: "handoff" }> => block.kind === "handoff",
    );
    if (sourceHandoff?.fromBotId === targetId) return refuse("hand-back", targetId);
    const hop = nextBotMessageHop(sourceHandoff?.hop);
    if (botMessageHopExhausted(hop)) return refuse("chain-exhausted", targetId);

    const handoffBlock: MessageBlock = {
      kind: "handoff",
      fromBotId: run.botId,
      toBotId: targetId,
      text: brief.task,
      ...(brief.constraints ? { constraints: brief.constraints } : {}),
      ...(brief.acceptance ? { acceptance: brief.acceptance } : {}),
      hop,
    };
    const message = await createThreadMessageInTransaction(tx, {
      threadId: run.threadId,
      role: "bot",
      blocks: [handoffBlock],
      botId: run.botId,
      runId: run.id,
      clientNonce: deliveryKey,
    });
    const task = await tx.task.create({
      data: {
        spaceId: run.spaceId,
        botId: targetId,
        threadId: run.threadId,
        userId: run.userId,
        prompt: buildHandoffWakePrompt({
          from: { id: run.botId, name: sender.bot.name },
          groupName: group.name,
          brief,
        }),
        status: "queued",
      },
    });
    const nextRun = await tx.run.create({
      data: {
        spaceId: run.spaceId,
        botId: targetId,
        threadId: run.threadId,
        taskId: task.id,
        userId: run.userId,
        status: "queued",
        trigger: "follow_up",
        sourceMessageId: message.id,
      },
    });
    const event = await appendEventInTransaction(tx, {
      spaceId: run.spaceId,
      threadId: run.threadId,
      botId: run.botId,
      type: "group.handoff",
      runId: run.id,
      payload: {
        messageId: message.id,
        fromBotId: run.botId,
        toBotId: targetId,
        text: brief.task,
        ...(brief.constraints ? { constraints: brief.constraints } : {}),
        ...(brief.acceptance ? { acceptance: brief.acceptance } : {}),
      },
    });
    await touchGroupUpdatedAt(tx, groupId);
    return { ok: true, botId: targetId, runId: nextRun.id, eventSeq: event.seq } as const;
  });
  if ("error" in committed) return committed;
  await deps.events.notify(run.threadId, committed.eventSeq).catch((error) => {
    getLogger().error("group handoff realtime notification", error);
  });
  await deps.jobs.enqueue(runContinueJob(committed.runId)).catch((error) => {
    // The queued run is durable and the job reconciler will repair a missed immediate wake.
    getLogger().error("group handoff enqueue", error);
  });
  return {
    ok: true,
    botId: committed.botId,
    runId: committed.runId,
    note: "Handoff recorded. End this turn without narrating it; the next bot owns the next stage.",
  };
}

export async function loadGroupContext(
  prisma: PrismaClient,
  groupId: string,
  self: { id: string; name: string },
): Promise<string | undefined> {
  const group = await prisma.chatGroup.findUnique({
    where: { id: groupId },
    include: {
      members: {
        where: { bot: { archivedAt: null } },
        include: {
          bot: { select: { id: true, name: true, title: true, description: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!group) return undefined;
  return renderGroupMembersContext(
    group.name,
    group.members.map((member) => member.bot),
    self,
  );
}
