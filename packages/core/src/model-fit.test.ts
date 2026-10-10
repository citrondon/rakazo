import { describe, expect, it } from "vitest";
import type { ModelFitOffer } from "./model-fit.js";
import { planTeamModels, scoreModelForNeed } from "./model-fit.js";

function offer(
  provider: string,
  modelId: string,
  extra: Partial<ModelFitOffer> = {},
): ModelFitOffer {
  return { provider, modelId, ...extra };
}

const connected: ModelFitOffer[] = [
  offer("opencode-go", "kimi-k2.7-code", { label: "Kimi K2.7 Code" }),
  offer("opencode-go", "mimo-v2.6-flash", { label: "MiMo Flash" }),
  offer("opencode-go", "qwen3.8-max", { label: "Qwen3.8 Max" }),
  offer("opencode-go", "deepseek-v4.1-flash-vision-exp", { reasoning: true }),
];

describe("scoreModelForNeed", () => {
  it("reads the kind of work out of the model name and label", () => {
    expect(scoreModelForNeed(offer("p", "kimi-k2.7-code"), "coding")).toBeGreaterThan(0);
    expect(scoreModelForNeed(offer("p", "x", { label: "Qwen Coder" }), "coding")).toBeGreaterThan(
      0,
    );
    expect(scoreModelForNeed(offer("p", "gpt-5-mini"), "fast")).toBeGreaterThan(0);
    expect(scoreModelForNeed(offer("p", "qwen3.8-vl"), "vision")).toBeGreaterThan(0);
    expect(scoreModelForNeed(offer("p", "claude-opus-5"), "reasoning")).toBeGreaterThan(0);
  });

  it("counts the catalog's reasoning flag", () => {
    const plain = scoreModelForNeed(offer("p", "mystery-1"), "reasoning");
    const flagged = scoreModelForNeed(offer("p", "mystery-1", { reasoning: true }), "reasoning");
    expect(plain).toBe(0);
    expect(flagged).toBeGreaterThan(plain);
  });

  it("scores nothing for a name it cannot place", () => {
    expect(scoreModelForNeed(offer("p", "mystery-1"), "coding")).toBe(0);
    expect(scoreModelForNeed(offer("p", "mystery-1"), "fast")).toBe(0);
  });
});

describe("planTeamModels", () => {
  it("honors a pinned model once that model is connected", () => {
    const plan = planTeamModels({
      members: [
        {
          preset: "grok-coder",
          needs: "coding",
          model: { provider: "opencode-go", modelId: "mimo-v2.6-flash", thinkingLevel: "high" },
        },
      ],
      offers: connected,
    });
    expect(plan).toEqual([
      {
        preset: "grok-coder",
        provider: "opencode-go",
        modelId: "mimo-v2.6-flash",
        thinkingLevel: "high",
        source: "pinned",
      },
    ]);
  });

  it("ignores a pin whose model is not connected", () => {
    const plan = planTeamModels({
      members: [
        {
          preset: "grok-coder",
          needs: "coding",
          model: { provider: "anthropic", modelId: "claude-opus-5", thinkingLevel: null },
        },
      ],
      offers: connected,
    });
    expect(plan[0]?.source).toBe("fit");
    expect(plan[0]?.provider).toBe("opencode-go");
    expect(plan[0]?.modelId).toBe("kimi-k2.7-code");
  });

  it("picks the best connected model for each need", () => {
    const plan = planTeamModels({
      members: [
        { preset: "grok-coder", needs: "coding" },
        { preset: "pr-reviewer", needs: "reasoning" },
        { preset: "trend-scout", needs: "fast" },
      ],
      offers: connected,
    });
    expect(plan.map((entry) => entry.modelId)).toEqual([
      "kimi-k2.7-code",
      "qwen3.8-max",
      "mimo-v2.6-flash",
    ]);
    expect(plan.every((entry) => entry.source === "fit")).toBe(true);
  });

  it("keeps the caller's order when two models fit equally well", () => {
    const plan = planTeamModels({
      members: [{ preset: "grok-coder", needs: "coding" }],
      // The space's own pick first; an equally fitting stranger must not displace it.
      offers: [offer("zeta", "model-a-code"), offer("alpha", "model-b-code")],
    });
    expect(plan[0]?.provider).toBe("zeta");
  });

  it("falls back to the space default when nothing fits", () => {
    const plan = planTeamModels({
      members: [{ preset: "executive-chief" }],
      offers: [offer("p", "mystery-1")],
      fallback: { provider: "opencode-go", modelId: "mimo-v2.6-flash", thinkingLevel: null },
    });
    expect(plan).toEqual([
      {
        preset: "executive-chief",
        provider: "opencode-go",
        modelId: "mimo-v2.6-flash",
        thinkingLevel: null,
        source: "default",
      },
    ]);
  });

  it("says none instead of guessing when nothing is connected", () => {
    const plan = planTeamModels({
      members: [{ preset: "grok-coder", needs: "coding" }],
      offers: [],
    });
    expect(plan).toEqual([
      { preset: "grok-coder", provider: null, modelId: null, thinkingLevel: null, source: "none" },
    ]);
  });
});
