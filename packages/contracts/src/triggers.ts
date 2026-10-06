import * as z from "zod";
import { MaxToolCallsPerTurnSchema } from "./agent-limits.js";
import { Id } from "./ids.js";

/**
 * Provider-neutral contracts for reactive triggers and the trust kit that gates them.
 * A trigger narrows one inbound event to one routine; the trust kit decides whether the
 * routine may run unattended, must dry-run first, or must wait for a person. Provider
 * adapters translate their own events into `TriggerEvent`; nothing here names a vendor.
 */

/** Where a reactive trigger listens. `cron` keeps schedules on the same footing as events. */
export const TriggerSourceSchema = z.enum(["connector", "webhook", "cron", "test"]);
export type TriggerSource = z.infer<typeof TriggerSourceSchema>;

export const TriggerOperatorSchema = z.enum([
  "equals",
  "contains",
  "startsWith",
  "endsWith",
  "oneOf",
  "regex",
  "exists",
  "gt",
  "lt",
  "gte",
  "lte",
]);
export type TriggerOperator = z.infer<typeof TriggerOperatorSchema>;

/** The operators that compare numbers instead of text; their value is a bound, not a needle. */
export const NUMERIC_TRIGGER_OPERATORS: readonly TriggerOperator[] = ["gt", "lt", "gte", "lte"];

/**
 * One narrow rule against an event field. `value` is omitted only for `exists`; `oneOf`
 * requires a non-empty list; every other operator takes one string, and the numeric
 * comparison operators take a number (a numeric string counts). Regexes are compiled
 * by the evaluator rather than here, so a stored rule never fails to load.
 */
export const TriggerPredicateSchema = z
  .object({
    field: z.string().min(1).max(200),
    operator: TriggerOperatorSchema,
    value: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
    caseSensitive: z.boolean().default(false),
  })
  .superRefine((predicate, ctx) => {
    if (predicate.operator === "exists") {
      if (predicate.value !== undefined) {
        ctx.addIssue({ code: "custom", message: "exists takes no value", path: ["value"] });
      }
      return;
    }
    if (predicate.operator === "oneOf") {
      if (!Array.isArray(predicate.value) || predicate.value.length === 0) {
        ctx.addIssue({ code: "custom", message: "oneOf needs a non-empty list", path: ["value"] });
      }
      return;
    }
    if (NUMERIC_TRIGGER_OPERATORS.includes(predicate.operator)) {
      if (!isNumericBound(predicate.value)) {
        ctx.addIssue({
          code: "custom",
          message: `${predicate.operator} needs a numeric value`,
          path: ["value"],
        });
      }
      return;
    }
    if (typeof predicate.value !== "string") {
      ctx.addIssue({
        code: "custom",
        message: `${predicate.operator} needs a string value`,
        path: ["value"],
      });
    }
  });
export type TriggerPredicate = z.infer<typeof TriggerPredicateSchema>;

/** A finite number, or a string that names one; anything else cannot bound a comparison. */
export function isNumericBound(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string" || value.trim() === "") return false;
  return Number.isFinite(Number(value));
}

/** All predicates must pass. An empty filter is a broad listener and is rejected on create. */
export const TriggerFilterSchema = z.object({
  predicates: z.array(TriggerPredicateSchema).max(20).default([]),
});
export type TriggerFilter = z.infer<typeof TriggerFilterSchema>;

/** Maps an event field onto a routine input so the prompt sees real values, not the raw event. */
export const TriggerMappingSchema = z.object({
  from: z.string().min(1).max(200),
  to: z.string().min(1).max(60),
});
export type TriggerMapping = z.infer<typeof TriggerMappingSchema>;

export const TriggerSchema = z.object({
  id: Id,
  routineId: Id,
  botId: Id,
  source: TriggerSourceSchema,
  provider: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9._-]+$/i),
  /** The provider event type this listens for, or null for any type from the provider. */
  eventType: z.string().min(1).max(200).nullable(),
  filter: TriggerFilterSchema,
  mappings: z.array(TriggerMappingSchema),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Trigger = z.infer<typeof TriggerSchema>;

export const CreateTriggerInput = z
  .object({
    routineId: Id,
    source: TriggerSourceSchema,
    provider: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[a-z0-9._-]+$/i),
    eventType: z.string().min(1).max(200).nullable().default(null),
    filter: TriggerFilterSchema.default(() => ({ predicates: [] })),
    mappings: z.array(TriggerMappingSchema).max(20).default([]),
    enabled: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    // A trigger with no predicate would fire on every event. Require a narrow rule.
    if (value.filter.predicates.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Add a matching rule so this trigger is not a broad listener",
        path: ["filter", "predicates"],
      });
    }
  });

/** Parsed shape a caller passes to create a trigger (defaults applied). */
export type CreateTriggerInput = z.infer<typeof CreateTriggerInput>;

export const UpdateTriggerInput = z
  .object({
    triggerId: Id,
    enabled: z.boolean().optional(),
    eventType: z.string().min(1).max(200).nullable().optional(),
    filter: TriggerFilterSchema.optional(),
    mappings: z.array(TriggerMappingSchema).max(20).optional(),
  })
  .superRefine((value, ctx) => {
    const changed = Object.entries(value).filter(([, entry]) => entry !== undefined);
    if (changed.length <= 1) {
      ctx.addIssue({ code: "custom", message: "Nothing to update", path: ["triggerId"] });
    }
    if (value.filter && value.filter.predicates.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Add a matching rule so this trigger is not a broad listener",
        path: ["filter", "predicates"],
      });
    }
  });

/** Parsed shape a caller passes to update a trigger; omitted fields stay unchanged. */
export type UpdateTriggerInput = z.infer<typeof UpdateTriggerInput>;

export const TRUST_RISKS = ["low", "medium", "high"] as const;
export const TrustRiskSchema = z.enum(TRUST_RISKS);
export type TrustRisk = z.infer<typeof TrustRiskSchema>;

/** What a planned effect does to the outside world; its risk tier is derived from this. */
export const TrustEffectActionSchema = z.enum([
  "read",
  "list",
  "draft",
  "create",
  "update",
  "notify",
  "delete",
  "transfer",
  "publish",
]);
export type TrustEffectAction = z.infer<typeof TrustEffectActionSchema>;

export const TrustEffectSchema = z.object({
  action: TrustEffectActionSchema,
  target: z.string().min(1).max(200),
  risk: TrustRiskSchema,
});
export type TrustEffect = z.infer<typeof TrustEffectSchema>;

/** Ordered phases a triggered run moves through before it may change anything. */
export const TRUST_PHASES = [
  "planned",
  "dryRun",
  "approval",
  "executed",
  "rejected",
  "paused",
] as const;
export const TrustPhaseSchema = z.enum(TRUST_PHASES);
export type TrustPhase = z.infer<typeof TrustPhaseSchema>;

/** A quiet window in local wall-clock time; `end` earlier than `start` wraps past midnight. */
export const QuietHoursSchema = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1).max(80).default("UTC"),
});
export type QuietHours = z.infer<typeof QuietHoursSchema>;

export const TrustPolicySchema = z.object({
  /** Lowest risk tier that pauses for a person. `high` means only the top tier asks. */
  approvalThreshold: TrustRiskSchema.default("medium"),
  /** When set, routines whose effects reach the threshold pause during this window. */
  quietHours: QuietHoursSchema.nullable().default(null),
  /** Per-turn tool-call fuse for this space. null inherits MAX_TOOL_CALLS_PER_TURN, 0 means unlimited. */
  maxToolCallsPerTurn: MaxToolCallsPerTurnSchema.default(null),
});
export type TrustPolicy = z.infer<typeof TrustPolicySchema>;

/**
 * Parsed shape a caller passes to store a space's trust policy. Every field carries a default, so an
 * empty object yields the safe policy rather than an implicit allow.
 */
export const UpdateTrustPolicyInput = TrustPolicySchema;
export type UpdateTrustPolicyInput = z.infer<typeof UpdateTrustPolicyInput>;

/**
 * `trust.get` / `trust.set` also report the deployment default, so settings can show what applies
 * while the space stores nothing of its own. 0 means the deployment is unlimited.
 */
export const TrustPolicyViewSchema = TrustPolicySchema.extend({
  maxToolCallsPerTurnDefault: z.number().int().min(0),
});
export type TrustPolicyView = z.infer<typeof TrustPolicyViewSchema>;

/** A normalized inbound event any provider adapter can produce for the trigger engine. */
export const TriggerEventSchema = z.object({
  source: TriggerSourceSchema,
  provider: z.string().min(1).max(50),
  type: z.string().min(1).max(200),
  payload: z.record(z.string(), z.unknown()),
});
export type TriggerEvent = z.infer<typeof TriggerEventSchema>;

/**
 * One discoverable event a trigger may listen for, as any surface renders it. The provider
 * adapter still owns translation; this is the catalog entry a UI offers, with the event fields
 * a filter or mapping may address.
 */
export const EventDefinitionSchema = z.object({
  id: z.string().min(1).max(200),
  provider: z.string().min(1).max(50),
  type: z.string().min(1).max(200),
  source: TriggerSourceSchema,
  label: z.string().min(1).max(200),
  fields: z.array(z.string().min(1).max(200)).max(50),
});
export type EventDefinition = z.infer<typeof EventDefinitionSchema>;
