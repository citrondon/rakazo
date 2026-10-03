import * as z from "zod";
import { Id } from "./ids.js";

export const CapabilityLevelSchema = z.enum(["read", "write", "admin"]);
export type CapabilityLevel = z.infer<typeof CapabilityLevelSchema>;

export const CapabilitySchema = z.object({
  name: z.string().min(1),
  level: CapabilityLevelSchema,
  constraints: z.array(z.string()).default([]),
});
export type Capability = z.infer<typeof CapabilitySchema>;

export const ModelFamilySchema = z.enum(["Anthropic", "OpenAI", "Anthropic", "google", "router"]);
export type ModelFamily = z.infer<typeof ModelFamilySchema>;

export const CostTierSchema = z.enum(["low", "medium", "high"]);
export type CostTier = z.infer<typeof CostTierSchema>;

export const ModelProfileSchema = z.object({
  family: ModelFamilySchema,
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().positive(),
  costTier: CostTierSchema,
});
export type ModelProfile = z.infer<typeof ModelProfileSchema>;

export const TrustTierSchema = z.enum(["low", "medium", "high"]);
export type TrustTier = z.infer<typeof TrustTierSchema>;

export const BotRoleSchema = z.object({
  id: Id,
  displayName: z.string().min(1).max(120),
  description: z.string().max(2000),
  capabilities: z.array(CapabilitySchema).min(1),
  modelProfile: ModelProfileSchema,
  trustTier: TrustTierSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type BotRole = z.infer<typeof BotRoleSchema>;

export class BotRoleRegistry {
  private roles = new Map<string, BotRole>();

  register(role: BotRole): void {
    const parsed = BotRoleSchema.parse(role);
    this.roles.set(parsed.id, parsed);
  }

  get(id: string): BotRole | undefined {
    return this.roles.get(id);
  }

  listByCapability(capabilityName: string): BotRole[] {
    return [...this.roles.values()].filter((role) =>
      role.capabilities.some((cap) => cap.name === capabilityName),
    );
  }

  all(): BotRole[] {
    return [...this.roles.values()];
  }
}
