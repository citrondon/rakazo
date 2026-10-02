import * as z from "zod";

export const GateNameSchema = z.enum(["ci", "two-family-review", "qa-verdict", "jev-decision"]);
export type GateName = z.infer<typeof GateNameSchema>;

export const GateStatusSchema = z.enum(["pass", "fail", "pending", "skipped"]);
export type GateStatus = z.infer<typeof GateStatusSchema>;

export const GateRequirementSchema = z.object({
  name: GateNameSchema,
  required: z.boolean(),
  timeoutMs: z.number().int().positive().optional(),
});
export type GateRequirement = z.infer<typeof GateRequirementSchema>;

export const GateResultSchema = z.object({
  name: GateNameSchema,
  status: GateStatusSchema,
  evidence: z.record(z.string(), z.unknown()),
  decidedAt: z.string().optional(),
});
export type GateResult = z.infer<typeof GateResultSchema>;

export const MergeGateInputSchema = z.object({
  prNumber: z.number().int().positive(),
  headSha: z.string().min(1),
  baseSha: z.string().min(1),
  requiredGates: z.array(GateRequirementSchema).min(1),
});
export type MergeGateInput = z.infer<typeof MergeGateInputSchema>;

export const MergeGateOutputSchema = z.object({
  allowed: z.boolean(),
  results: z.array(GateResultSchema),
});
export type MergeGateOutput = z.infer<typeof MergeGateOutputSchema>;