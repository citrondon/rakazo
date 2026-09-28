import { type Actor, MessageBlock, type RunReceipt } from "@rakazo/contracts";
import { buildRunReceipt } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";

const TOOL_EVENT_TYPES = ["agent.tool.called", "agent.tool.completed"];

interface ApprovalRow {
  question: string;
  status: "pending" | "answered";
  answer: string | null;
}

/**
 * Approval cards the run produced. They live in the run's own messages, so the receipt
 * reports what the user actually saw rather than a second copy of the question.
 */
export function approvalsFromMessageBlocks(blocks: unknown[]): ApprovalRow[] {
  const approvals: ApprovalRow[] = [];
  for (const raw of blocks) {
    const parsed = MessageBlock.array().safeParse(raw);
    if (!parsed.success) continue;
    for (const block of parsed.data) {
      if (block.kind !== "ask") continue;
      approvals.push({
        question: block.text,
        status: block.status === "answered" ? "answered" : "pending",
        answer: block.answer ?? null,
      });
    }
  }
  return approvals;
}

/**
 * One run's receipt, or null when the run is not this actor's. Reads only stored rows:
 * the receipt must not depend on a live sandbox, provider, or model call.
 */
export async function loadRunReceipt(
  prisma: PrismaClient,
  actor: Actor,
  runId: string,
): Promise<RunReceipt | null> {
  const run = await prisma.run.findFirst({
    where: { id: runId, spaceId: actor.spaceId, userId: actor.userId },
    select: {
      id: true,
      botId: true,
      threadId: true,
      trigger: true,
      status: true,
      modelProvider: true,
      modelId: true,
      startedAt: true,
      completedAt: true,
      error: true,
      bot: { select: { name: true } },
      usageRecords: {
        select: {
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheWriteTokens: true,
        },
      },
      effects: { select: { kind: true, status: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!run) return null;

  const [toolEvents, artifacts, messages] = await Promise.all([
    prisma.event.findMany({
      where: { runId: run.id, type: { in: TOOL_EVENT_TYPES } },
      orderBy: { seq: "asc" },
      select: { type: true, payload: true },
    }),
    prisma.artifact.findMany({
      where: { runId: run.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, mimeType: true, size: true, version: true },
    }),
    prisma.message.findMany({
      where: { runId: run.id },
      orderBy: { seq: "asc" },
      select: { blocks: true },
    }),
  ]);

  return buildRunReceipt({
    run: {
      id: run.id,
      botId: run.botId,
      botName: run.bot.name,
      threadId: run.threadId,
      trigger: run.trigger,
      status: run.status,
      modelProvider: run.modelProvider,
      modelId: run.modelId,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      error: run.error,
    },
    toolEvents,
    usage: run.usageRecords,
    artifacts,
    effects: run.effects,
    approvals: approvalsFromMessageBlocks(messages.map((message) => message.blocks)),
  });
}
