import type { TeamModelChoice, TeamModelNeed, TeamModelPin } from "@bobbot/contracts";

/**
 * Which connected model fits which kind of work.
 *
 * A roster names the kind of work a member does (`coding`, `reasoning`, `fast`,
 * `vision`) instead of a model, so the same roster works wherever it is started. The
 * start then picks from the models the caller has actually connected. That mapping has
 * to be readable, not a guess buried in a run, so it lives here: a name that says what
 * it is (`kimi-k2.7-code`, `gpt-5-mini`, `qwen3.8-vl`) scores high, the catalog's own
 * `reasoning` flag counts, and a model nobody can place scores zero and loses to the
 * space default instead of winning by accident.
 *
 * Extend this table when a new family shows up; do not add model names to rosters.
 */

/** What the planner knows about one connected model. */
export type ModelFitOffer = {
  provider: string;
  modelId: string;
  label?: string;
  reasoning?: boolean;
};

type FitRule = { tokens: readonly string[]; score: number };

const FIT_RULES: Record<TeamModelNeed, readonly FitRule[]> = {
  coding: [
    {
      tokens: ["code", "coder", "coding", "swe", "dev", "engineering", "kata"],
      score: 4,
    },
  ],
  reasoning: [
    { tokens: ["pro", "max", "opus", "thinking", "reason", "r1", "o3", "o4"], score: 3 },
    { tokens: ["plus", "ultra", "large"], score: 1 },
  ],
  fast: [
    { tokens: ["flash", "mini", "nano", "lite", "small", "haiku", "turbo", "instant"], score: 3 },
    { tokens: ["free"], score: 1 },
  ],
  vision: [{ tokens: ["vision", "vl", "vlm", "omni", "multimodal", "image"], score: 3 }],
};

const REASONING_FLAG_SCORE = 3;

/** Split an id or label into comparable lowercase tokens: `kimi-k2.7-code` → kimi, k2.7, code. */
function fitTokens(...values: (string | undefined)[]): string[] {
  return values
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter(Boolean);
}

/** How well a model answers a need. Zero means "no idea", not "bad". */
export function scoreModelForNeed(offer: ModelFitOffer, need: TeamModelNeed): number {
  const tokens = new Set(fitTokens(offer.modelId, offer.label));
  let score = 0;
  for (const rule of FIT_RULES[need]) {
    if (rule.tokens.some((token) => tokens.has(token))) score += rule.score;
  }
  if (need === "reasoning" && offer.reasoning) score += REASONING_FLAG_SCORE;
  return score;
}

/** A member as the planner sees it: a preset, the work it does, an optional pinned model. */
export type TeamModelRequest = {
  preset: string;
  needs?: TeamModelNeed;
  model?: TeamModelPin;
};

export type TeamModelPlanInput = {
  members: readonly TeamModelRequest[];
  /**
   * Models the caller can run, in preference order: what the space already picked
   * first. Equal fits keep this order.
   */
  offers: readonly ModelFitOffer[];
  /** The space default, used when nothing fits. */
  fallback?: TeamModelPin | null;
};

function pinChoice(
  preset: string,
  pin: TeamModelPin,
  source: TeamModelChoice["source"],
): TeamModelChoice {
  return {
    preset,
    provider: pin.provider,
    modelId: pin.modelId,
    thinkingLevel: pin.thinkingLevel ?? null,
    source,
  };
}

function bestOfferFor(
  offers: readonly ModelFitOffer[],
  need: TeamModelNeed | undefined,
): ModelFitOffer | null {
  if (!need) return null;
  const scored = offers
    .map((offer) => ({ offer, score: scoreModelForNeed(offer, need) }))
    .filter((entry) => entry.score > 0)
    // The best fit wins; equal scores keep the order the caller gave, so the space's own
    // models can win a tie over an equally fitting stranger (sort is stable).
    .sort((a, b) => b.score - a.score);
  return scored[0]?.offer ?? null;
}

/**
 * Propose a model for every member: the roster's pin when that model is connected, else
 * the best connected model for the member's need, else the space default. Never throws:
 * a roster with no connected model still produces a plan whose entries say `none`, and
 * the run then falls back the way any bot without an override does.
 */
export function planTeamModels(input: TeamModelPlanInput): TeamModelChoice[] {
  const offers = input.offers;
  const fallback = input.fallback ?? null;
  return input.members.map((member) => {
    if (member.model) {
      const connected = offers.some(
        (offer) =>
          offer.provider === member.model?.provider && offer.modelId === member.model?.modelId,
      );
      if (connected) return pinChoice(member.preset, member.model, "pinned");
    }
    const best = bestOfferFor(offers, member.needs);
    if (best) {
      return {
        preset: member.preset,
        provider: best.provider,
        modelId: best.modelId,
        thinkingLevel: null,
        source: "fit",
      };
    }
    if (fallback) return pinChoice(member.preset, fallback, "default");
    return {
      preset: member.preset,
      provider: null,
      modelId: null,
      thinkingLevel: null,
      source: "none",
    };
  });
}
