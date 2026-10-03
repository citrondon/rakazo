import * as z from "zod";
import { ModelProfileSchema } from "./bot-role.js";
import { Id } from "./ids.js";

export const DelegationRequestSchema = z.object({
  missionId: z.string().min(1),
  sliceId: z.string().min(1),
  roleId: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  parentSeatId: z.string().optional(),
  modelOverride: ModelProfileSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
  artifacts: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
});
export type DelegationRequest = z.infer<typeof DelegationRequestSchema>;

export const DelegationResultSchema = z.object({
  success: z.boolean(),
  artifacts: z.array(z.string()).default([]),
  logs: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type DelegationResult = z.infer<typeof DelegationResultSchema>;

export const QueueEntryStatusSchema = z.enum([
  "pending",
  "assigned",
  "running",
  "done",
  "failed",
  "blocked",
]);
export type QueueEntryStatus = z.infer<typeof QueueEntryStatusSchema>;

export const QueueEntrySchema = z.object({
  id: z.string().min(1),
  request: DelegationRequestSchema,
  status: QueueEntryStatusSchema,
  assignedBotId: z.string().optional(),
  worktreePath: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  result: DelegationResultSchema.optional(),
});
export type QueueEntry = z.infer<typeof QueueEntrySchema>;
