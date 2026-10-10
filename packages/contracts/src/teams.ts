import * as z from "zod";
import { BotSchema, GroupSchema } from "./domain.js";

/**
 * A team template is the roster a Grokbot team starts from: which presets become
 * bots, which connectors they expect, and the first message the lead receives so
 * the team starts working instead of idling.
 */

/** A team stays small on purpose; a fifth bot is a second team, not a bigger one. */
export const TEAM_MEMBERS_MAX_COUNT = 4;

/** Ids and preset names are lowercase slugs: they become file names and rpc input. */
const TEAM_SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * What a member has to be good at. A roster says the kind of work, never a model
 * name: which model fits is decided where the connected models are known, so the
 * same roster works on a deployment with a different provider.
 */
export const TEAM_MODEL_NEEDS = ["coding", "reasoning", "fast", "vision"] as const;
export const TeamModelNeedSchema = z.enum(TEAM_MODEL_NEEDS);
export type TeamModelNeed = z.infer<typeof TeamModelNeedSchema>;

/** A model pinned by a roster that must not be guessed (kept as an override). */
export const TeamModelPinSchema = z.object({
  provider: z.string().trim().min(1).max(64),
  modelId: z.string().trim().min(1).max(200),
  thinkingLevel: z.string().trim().min(1).max(32).nullable().default(null),
});
export type TeamModelPin = z.infer<typeof TeamModelPinSchema>;

export const TeamTemplateMemberSchema = z.object({
  /** A bot preset in `bot-library`, named without the `.v1.json` suffix. */
  preset: z.string().trim().regex(TEAM_SLUG),
  role: z.string().trim().min(1).max(120),
  /**
   * What this member owns, appended to the preset's own instructions when the team
   * starts. `role` stays a label for the roster; this is the text the bot reads.
   */
  instructions: z.string().trim().min(1).max(4_000).optional(),
  /** Which kind of model this member needs; the start picks a connected one. */
  needs: TeamModelNeedSchema.optional(),
  /** An exact model, for a roster that only works on one. */
  model: TeamModelPinSchema.optional(),
});

/**
 * The schedule that keeps a team going after its first task. A handoff chain is capped
 * at `BOT_MESSAGE_MAX_HOPS`, so a project longer than one chain needs a fresh wake: this
 * recurring nudge starts the lead again inside the team's own group chat.
 *
 * `active` has no default on purpose — a template that ships automation says out loud
 * whether starting the team also arms the schedule.
 */
export const TeamAutomationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(4_000),
  crons: z.array(z.string().trim().min(1)).min(1).max(8),
  timezone: z.string().trim().min(1).max(80).default("UTC"),
  active: z.boolean(),
});

export type TeamAutomation = z.infer<typeof TeamAutomationSchema>;

/** The first member is the lead: it receives `firstTask` and any `automation`. */
export const TeamTemplateSchema = z.object({
  id: z.string().trim().regex(TEAM_SLUG),
  label: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(200),
  members: z.array(TeamTemplateMemberSchema).min(2).max(TEAM_MEMBERS_MAX_COUNT),
  /** Rules every member shares, appended after each member's own instructions. */
  protocol: z.string().trim().min(1).max(8_000).optional(),
  /** Connectors the roster expects. Advisory: creating a team connects nothing. */
  integrations: z.array(z.string().trim().min(1).max(64)).max(12).default([]),
  firstTask: z.string().trim().min(1).max(1_000),
  automation: TeamAutomationSchema.optional(),
});

export type TeamTemplate = z.infer<typeof TeamTemplateSchema>;
export type TeamTemplateMember = z.infer<typeof TeamTemplateMemberSchema>;

/**
 * Where a member's model came from: the roster pinned it, a connected model fit the
 * need, the space default answered, or nothing was connected at all (the run then
 * falls back to the deployment default the way any bot without an override does).
 */
export const TEAM_MODEL_CHOICE_SOURCES = ["pinned", "fit", "default", "none"] as const;

export const TeamModelChoiceSchema = z.object({
  preset: z.string(),
  provider: z.string().nullable(),
  modelId: z.string().nullable(),
  thinkingLevel: z.string().nullable(),
  source: z.enum(TEAM_MODEL_CHOICE_SOURCES),
});
export type TeamModelChoice = z.infer<typeof TeamModelChoiceSchema>;

/** A roster as the client sees it: the template plus what the caller could run it on. */
export const TeamTemplatePlanSchema = TeamTemplateSchema.extend({
  modelPlan: z.array(TeamModelChoiceSchema),
});
export type TeamTemplatePlan = z.infer<typeof TeamTemplatePlanSchema>;

/**
 * The answer to "Who are you?" at the start. An identity does not describe a bot;
 * it names the team a new space begins with, so the first screen asks one question
 * instead of showing an empty roster.
 */
export const IdentitySchema = z.object({
  id: z.string().trim().regex(TEAM_SLUG),
  /** The label the original library uses, shown as written. */
  label: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(200),
  /** A team template id in `bot-library/teams`; the caller resolves it before use. */
  team: z.string().trim().regex(TEAM_SLUG),
});

export type Identity = z.infer<typeof IdentitySchema>;

/**
 * Starting a team is one call: the caller names the roster, or the identity that
 * stands for it, and the server builds every bot, the group and the lead's first
 * task together. No `spaceId` — the caller already acts inside a space.
 */
export const TeamCreateInputSchema = z
  .object({
    templateId: z.string().trim().regex(TEAM_SLUG).optional(),
    identityId: z.string().trim().regex(TEAM_SLUG).optional(),
    /** Overrides the group name; the template label is the default. */
    name: z.string().trim().min(1).max(80).optional(),
    /**
     * A model per member, keyed by preset. Absent means the server proposes one; a
     * named model has to be connected, so a start cannot silently run on something else.
     */
    models: z
      .array(
        z.object({
          preset: z.string().trim().regex(TEAM_SLUG),
          provider: z.string().trim().min(1).max(64),
          modelId: z.string().trim().min(1).max(200),
          thinkingLevel: z.string().trim().min(1).max(32).nullable().default(null),
        }),
      )
      .max(TEAM_MEMBERS_MAX_COUNT)
      .optional(),
  })
  .refine((value) => (value.templateId ? value.identityId === undefined : !!value.identityId), {
    error: "Name either a template or an identity.",
  });

export type TeamCreateInput = z.infer<typeof TeamCreateInputSchema>;

/** The group and the bots that were created, in roster order. */
export const TeamCreateOutputSchema = z.object({
  group: GroupSchema,
  bots: z.array(BotSchema),
});

export type TeamCreateOutput = z.infer<typeof TeamCreateOutputSchema>;
