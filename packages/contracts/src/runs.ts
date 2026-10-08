import * as z from "zod";
import { Id, RunStatus } from "./ids.js";

export const RunTriggerSchema = z.enum([
  "user",
  "routine",
  "resume",
  "follow_up",
  "reaction",
  "call_end",
  "spawn",
  "skill",
  "bot_message",
  "webhook",
  "messaging",
  "cloud_agent",
  "created",
]);
export type RunTrigger = z.infer<typeof RunTriggerSchema>;

/**
 * Runs no person in this app started: a schedule woke the bot, another bot handed work over, a bot
 * spawned one, an external system called a webhook, or a cloud agent reported back. A message that
 * arrived over a messaging channel is deliberately not in here — somebody typed it, just not here.
 */
export const AUTONOMOUS_RUN_TRIGGERS: readonly RunTrigger[] = [
  "routine",
  "bot_message",
  "spawn",
  "webhook",
  "cloud_agent",
];

export const RunActivityFilterSchema = z.enum(["active", "recent", "unattended"]);
export type RunActivityFilter = z.infer<typeof RunActivityFilterSchema>;

export const RunActivityRowSchema = z.object({
  runId: Id,
  botId: Id,
  botName: z.string(),
  groupId: Id.nullable(),
  groupName: z.string().nullable(),
  threadId: Id,
  status: RunStatus,
  trigger: RunTriggerSchema,
  notificationsEnabled: z.boolean(),
  promptSnippet: z.string(),
  updatedAt: z.string(),
});
export type RunActivityRow = z.infer<typeof RunActivityRowSchema>;

export const RunsListOutputSchema = z.object({
  runs: z.array(RunActivityRowSchema),
});
export type RunsListOutput = z.infer<typeof RunsListOutputSchema>;

/** Token totals a run really consumed. Derived from its usage rows, never estimated. */
export const RunTokenTotalsSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export type RunTokenTotals = z.infer<typeof RunTokenTotalsSchema>;

/** One tool the run called, folded per tool name so a receipt stays one screen long. */
export const RunReceiptToolSchema = z.object({
  name: z.string(),
  calls: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  paused: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type RunReceiptTool = z.infer<typeof RunReceiptToolSchema>;

export const RunReceiptArtifactSchema = z.object({
  id: Id,
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  version: z.number().int().positive(),
});
export type RunReceiptArtifact = z.infer<typeof RunReceiptArtifactSchema>;

/** An approval card the run produced, as it stood when the receipt was read. */
export const RunReceiptApprovalSchema = z.object({
  question: z.string(),
  status: z.enum(["pending", "answered"]),
  answer: z.string().nullable(),
});
export type RunReceiptApproval = z.infer<typeof RunReceiptApprovalSchema>;

/** An external effect the run recorded; status is the executor's, not the model's claim. */
export const RunReceiptEffectSchema = z.object({
  kind: z.string(),
  status: z.string(),
});
export type RunReceiptEffect = z.infer<typeof RunReceiptEffectSchema>;

export const RunReceiptSchema = z.object({
  runId: Id,
  botId: Id,
  botName: z.string(),
  threadId: Id,
  trigger: RunTriggerSchema,
  status: RunStatus,
  modelProvider: z.string().nullable(),
  modelId: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  /** Null when the run never reached a model call; distinct from zero tokens. */
  tokens: RunTokenTotalsSchema.nullable(),
  tools: z.array(RunReceiptToolSchema),
  toolCalls: z.number().int().nonnegative(),
  effects: z.array(RunReceiptEffectSchema),
  artifacts: z.array(RunReceiptArtifactSchema),
  approvals: z.array(RunReceiptApprovalSchema),
  /** Why the run stopped short, when it did. */
  stopReason: z.string().nullable(),
});
export type RunReceipt = z.infer<typeof RunReceiptSchema>;
