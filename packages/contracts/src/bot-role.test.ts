import { describe, it, expect } from "vitest";
import { BotRoleSchema, CapabilitySchema, ModelProfileSchema, BotRoleRegistry } from "./bot-role.js";

describe("BotRole", () => {
  it("validates a complete role with capabilities and model profile", () => {
    const role = BotRoleSchema.parse({
      id: "checkout-architect",
      displayName: "Checkout Architect",
      description: "Designs payment flow architecture",
      capabilities: [
        { name: "terminal", level: "write", constraints: [] },
        { name: "browser", level: "read", constraints: [] },
        { name: "git", level: "write", constraints: ["no-force-push"] },
      ],
      modelProfile: {
        family: "Anthropic",
        model: "claude-opus-4",
        temperature: 0.2,
        maxTokens: 8192,
        costTier: "high",
      },
      trustTier: "high",
      metadata: { domain: "payments" },
    });
    expect(role.id).toBe("checkout-architect");
    expect(role.capabilities).toHaveLength(3);
  });

  it("rejects unknown capability level", () => {
    expect(() => BotRoleSchema.parse({
      id: "test", displayName: "T", description: "D",
      capabilities: [{ name: "terminal", level: "invalid", constraints: [] }],
      modelProfile: { family: "Anthropic", model: "claude", temperature: 0, maxTokens: 100, costTier: "low" },
      trustTier: "low",
    })).toThrow();
  });

  it("registry lists roles by capability", () => {
    const reg = new BotRoleRegistry();
    reg.register({ id: "r1", displayName: "R1", description: "D", capabilities: [{ name: "terminal", level: "write", constraints: [] }], modelProfile: { family: "Anthropic", model: "c", temperature: 0, maxTokens: 100, costTier: "low" }, trustTier: "low" });
    reg.register({ id: "r2", displayName: "R2", description: "D", capabilities: [{ name: "browser", level: "read", constraints: [] }], modelProfile: { family: "Anthropic", model: "c", temperature: 0, maxTokens: 100, costTier: "low" }, trustTier: "low" });
    expect(reg.listByCapability("terminal")).toHaveLength(1);
    expect(reg.listByCapability("browser")).toHaveLength(1);
  });
});