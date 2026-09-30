import * as z from "zod";

/**
 * A team template is the roster a Grokbot team starts from: which presets become
 * bots, which connectors they expect, and the first message the lead receives so
 * the team starts working instead of idling.
 */

/** A team stays small on purpose; a fifth bot is a second team, not a bigger one. */
export const TEAM_MEMBERS_MAX_COUNT = 4;

/** Ids and preset names are lowercase slugs: they become file names and rpc input. */
const TEAM_SLUG = /^[a-z0-9][a-z0-9-]*$/;

export const TeamTemplateMemberSchema = z.object({
  /** A bot preset in `bot-library`, named without the `.v1.json` suffix. */
  preset: z.string().trim().regex(TEAM_SLUG),
  role: z.string().trim().min(1).max(120),
});

/** The first member is the lead: it receives `firstTask`. */
export const TeamTemplateSchema = z.object({
  id: z.string().trim().regex(TEAM_SLUG),
  label: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(200),
  members: z.array(TeamTemplateMemberSchema).min(2).max(TEAM_MEMBERS_MAX_COUNT),
  /** Connectors the roster expects. Advisory: creating a team connects nothing. */
  integrations: z.array(z.string().trim().min(1).max(64)).max(12).default([]),
  firstTask: z.string().trim().min(1).max(1_000),
});

export type TeamTemplate = z.infer<typeof TeamTemplateSchema>;
export type TeamTemplateMember = z.infer<typeof TeamTemplateMemberSchema>;
