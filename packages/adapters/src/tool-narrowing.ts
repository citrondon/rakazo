import { declaredSkillTools } from "@bobbot/core";

/**
 * What a run is offered, narrowed to the skills the prompt actually asks for.
 *
 * A model picks the right tool reliably out of about ten and unreliably out of thirty, and a
 * deployment that connects two vendors passes thirty on its first afternoon. So a run is offered
 * the connector tools its matching skills declare, plus every connector tool no skill claims.
 *
 * This decides what the model can see and nothing else. Grants, the approval rules and the trusted
 * action gate stay the authority, a declaration grants nothing, and every way this can fail — no
 * skills saved, nothing matched, no declarations at all — leaves the whole offer in place. A
 * narrowing that failed closed would silently take away a tool the user connected.
 *
 * Builtin tools are deliberately not narrowed here: the run already narrows them by what it can do
 * (graphics, browser, group, trigger, voice), and a skill that named one of them would otherwise be
 * able to switch off the escape hatch a run needs to ask a person.
 */

export type NarrowableTool = { name: string };
export type NarrowableSkill = { name: string; description: string; content: string };

/** A prompt rarely needs more than a few recipes; more selected skills only widen the offer again. */
export const MAX_SELECTED_SKILLS = 3;
/** A name hit alone clears this; a description hit alone does not. */
const MIN_SKILL_SCORE = 3;
const NAME_HIT = 3;
/** German compounds land here: "Diagrammerstellung" against a skill called "diagramm-bauer". */
const NAME_PREFIX_HIT = 3;
const DESCRIPTION_HIT = 1;
const PREFIX_MIN_LENGTH = 5;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "you",
  "your",
  "please",
  "can",
  "could",
  "would",
  "use",
  "using",
  "make",
  "mach",
  "mache",
  "bitte",
  "und",
  "der",
  "die",
  "das",
  "den",
  "dem",
  "des",
  "ein",
  "eine",
  "einen",
  "einem",
  "für",
  "mit",
  "von",
  "auf",
  "zum",
  "zur",
  "ist",
  "sind",
  "soll",
  "sollte",
  "kann",
  "können",
  "nutze",
  "benutze",
  "erstelle",
]);

/** Words worth matching on: lowercase, at least three characters, no filler. */
export function promptTokens(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((word) => word.length >= 3 && !STOPWORDS.has(word)))];
}

function overlapsPrefix(token: string, other: string): boolean {
  if (token.length < PREFIX_MIN_LENGTH || other.length < PREFIX_MIN_LENGTH) return false;
  return token.startsWith(other) || other.startsWith(token);
}

function scoreSkill(tokens: readonly string[], skill: NarrowableSkill): number {
  const nameTokens = promptTokens(skill.name);
  const descriptionTokens = promptTokens(skill.description);
  let score = 0;
  for (const token of tokens) {
    if (nameTokens.includes(token)) {
      score += NAME_HIT;
      continue;
    }
    if (descriptionTokens.includes(token)) {
      score += DESCRIPTION_HIT;
      continue;
    }
    if (nameTokens.some((name) => overlapsPrefix(token, name))) score += NAME_PREFIX_HIT;
  }
  return score;
}

/** The skills a prompt asks for, best first. An empty list means "no idea — offer everything". */
export function selectSkillsForPrompt(
  prompt: string,
  skills: readonly NarrowableSkill[],
): string[] {
  const tokens = promptTokens(prompt);
  if (tokens.length === 0 || skills.length === 0) return [];
  return skills
    .map((skill) => ({ name: skill.name, score: scoreSkill(tokens, skill) }))
    .filter((entry) => entry.score >= MIN_SKILL_SCORE)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.name.localeCompare(b.name)))
    .slice(0, MAX_SELECTED_SKILLS)
    .map((entry) => entry.name);
}

export type ToolOfferReason =
  | "no-tools"
  | "no-skills"
  | "no-declaration"
  | "no-skill-matched"
  | "no-change"
  | "narrowed";

export type ToolOffer<T extends NarrowableTool> = {
  /** Exactly what the run may see. Never a subset the caller has to widen again. */
  tools: T[];
  /** Skills whose name or description matched this prompt. */
  selectedSkills: string[];
  /** Tools this prompt does not need; empty unless the reason is "narrowed". */
  droppedTools: string[];
  reason: ToolOfferReason;
};

export function planConnectorToolOffer<T extends NarrowableTool>(input: {
  tools: readonly T[];
  skills: readonly NarrowableSkill[];
  prompt: string;
}): ToolOffer<T> {
  const { tools, skills, prompt } = input;
  const declared = skills.map((skill) => ({
    name: skill.name,
    tools: declaredSkillTools(skill.content),
  }));
  const claimed = new Set(declared.flatMap((entry) => entry.tools));
  const failOpen = (reason: ToolOfferReason): ToolOffer<T> => ({
    tools: [...tools],
    selectedSkills: [],
    droppedTools: [],
    reason,
  });

  if (tools.length === 0) return failOpen("no-tools");
  if (skills.length === 0) return failOpen("no-skills");
  if (claimed.size === 0) return failOpen("no-declaration");

  const selectedSkills = selectSkillsForPrompt(prompt, skills);
  if (selectedSkills.length === 0) return failOpen("no-skill-matched");

  const wanted = new Set(
    declared.filter((entry) => selectedSkills.includes(entry.name)).flatMap((entry) => entry.tools),
  );
  const offered = tools.filter((tool) => !claimed.has(tool.name) || wanted.has(tool.name));
  if (offered.length === tools.length) {
    return { tools: [...tools], selectedSkills, droppedTools: [], reason: "no-change" };
  }
  return {
    tools: offered,
    selectedSkills,
    droppedTools: tools.filter((tool) => !offered.includes(tool)).map((tool) => tool.name),
    reason: "narrowed",
  };
}
