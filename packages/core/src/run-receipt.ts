import type {
  RunReceipt,
  RunReceiptApproval,
  RunReceiptEffect,
  RunReceiptTool,
  RunTokenTotals,
} from "@bobbot/contracts";

/**
 * Everything a receipt needs, already read from storage. The builder stays pure so the
 * same derivation serves the API, tests, and any future export without a second source
 * of truth for what a run did.
 */
export interface RunReceiptInput {
  run: {
    id: string;
    botId: string;
    botName: string;
    threadId: string;
    trigger: string;
    status: string;
    modelProvider: string | null;
    modelId: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    error: string | null;
  };
  /** `agent.tool.called` and `agent.tool.completed` rows for this run, in sequence order. */
  toolEvents: ReadonlyArray<{ type: string; payload: unknown }>;
  usage: ReadonlyArray<{
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }>;
  artifacts: ReadonlyArray<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    version: number;
  }>;
  effects: ReadonlyArray<{ kind: string; status: string }>;
  approvals: ReadonlyArray<{
    question: string;
    status: "pending" | "answered";
    answer: string | null;
  }>;
}

function eventName(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const name = (payload as { name?: unknown }).name;
  return typeof name === "string" ? name.trim() : "";
}

function eventDurationMs(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const value = Number((payload as { durationMs?: unknown }).durationMs);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function eventOutcome(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const outcome = (payload as { outcome?: unknown }).outcome;
  return typeof outcome === "string" ? outcome : "";
}

/**
 * Fold a run's tool events per tool name. Discovery failures arrive as completions
 * without a preceding call, so a tool's call count is the larger of the two.
 */
export function summarizeRunTools(events: RunReceiptInput["toolEvents"]): RunReceiptTool[] {
  interface Accumulated {
    name: string;
    calls: number;
    completions: number;
    failures: number;
    paused: number;
    durationMs: number;
  }
  const byName = new Map<string, Accumulated>();
  const bucket = (name: string): Accumulated => {
    const existing = byName.get(name);
    if (existing) return existing;
    const created: Accumulated = {
      name,
      calls: 0,
      completions: 0,
      failures: 0,
      paused: 0,
      durationMs: 0,
    };
    byName.set(name, created);
    return created;
  };
  for (const event of events) {
    const name = eventName(event.payload);
    if (!name) continue;
    if (event.type === "agent.tool.called") {
      bucket(name).calls += 1;
      continue;
    }
    if (event.type !== "agent.tool.completed") continue;
    const summary = bucket(name);
    summary.completions += 1;
    const outcome = eventOutcome(event.payload);
    if (outcome === "error") summary.failures += 1;
    else if (outcome === "paused") summary.paused += 1;
    summary.durationMs += eventDurationMs(event.payload);
  }
  return [...byName.values()]
    .map(({ name, calls, completions, failures, paused, durationMs }) => ({
      name,
      calls: Math.max(calls, completions),
      failures,
      paused,
      durationMs,
    }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}

/** Token totals for a run, or null when it never reached a model call. */
export function sumRunTokens(usage: RunReceiptInput["usage"]): RunTokenTotals | null {
  if (usage.length === 0) return null;
  const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  for (const row of usage) {
    totals.inputTokens += row.inputTokens;
    totals.outputTokens += row.outputTokens;
    totals.cacheReadTokens += row.cacheReadTokens;
    totals.cacheWriteTokens += row.cacheWriteTokens;
  }
  return {
    ...totals,
    totalTokens:
      totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens,
  };
}

export function buildRunReceipt(input: RunReceiptInput): RunReceipt {
  const tools = summarizeRunTools(input.toolEvents);
  const { startedAt, completedAt } = input.run;
  const stopReason = input.run.error?.trim();
  const approvals: RunReceiptApproval[] = input.approvals
    .filter((approval) => approval.question.trim().length > 0)
    .map((approval) => ({
      question: approval.question,
      status: approval.status,
      answer: approval.answer,
    }));
  const effects: RunReceiptEffect[] = input.effects.map((effect) => ({
    kind: effect.kind,
    status: effect.status,
  }));
  return {
    runId: input.run.id,
    botId: input.run.botId,
    botName: input.run.botName,
    threadId: input.run.threadId,
    trigger: input.run.trigger as RunReceipt["trigger"],
    status: input.run.status as RunReceipt["status"],
    modelProvider: input.run.modelProvider,
    modelId: input.run.modelId,
    startedAt: startedAt ? startedAt.toISOString() : null,
    completedAt: completedAt ? completedAt.toISOString() : null,
    durationMs:
      startedAt && completedAt ? Math.max(0, completedAt.getTime() - startedAt.getTime()) : null,
    tokens: sumRunTokens(input.usage),
    tools,
    toolCalls: tools.reduce((total, tool) => total + tool.calls, 0),
    effects,
    artifacts: input.artifacts.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      mimeType: artifact.mimeType,
      size: artifact.size,
      version: artifact.version,
    })),
    approvals,
    stopReason: stopReason ? stopReason : null,
  };
}
