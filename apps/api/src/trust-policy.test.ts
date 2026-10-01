import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { getTrustPolicy, setTrustPolicy } from "./trust-policy.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "ws-1",
  email: "test@example.com",
  isDeploymentOwner: false,
};

describe("getTrustPolicy handler", () => {
  it("returns the safe default when the space stores none", async () => {
    const deps = {
      prisma: { trustPolicy: { findUnique: vi.fn(async () => null) } } as unknown as PrismaClient,
    };
    await expect(getTrustPolicy(deps, actor)).resolves.toEqual({
      approvalThreshold: "medium",
      quietHours: null,
    });
  });
});

describe("setTrustPolicy handler", () => {
  it("persists the policy against the actor's space", async () => {
    const upsert = vi.fn(async (_args: unknown) => ({
      approvalThreshold: "low",
      quietHours: null,
    }));
    const deps = { prisma: { trustPolicy: { upsert } } as unknown as PrismaClient };

    const policy = await setTrustPolicy(deps, actor, {
      approvalThreshold: "low",
      quietHours: null,
    });

    expect(policy.approvalThreshold).toBe("low");
    expect((upsert.mock.calls[0]![0] as { where: unknown }).where).toEqual({ spaceId: "ws-1" });
  });
});
