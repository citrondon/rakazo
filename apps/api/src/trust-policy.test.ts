import type { Actor } from "@bobbot/contracts";
import type { PrismaClient } from "@bobbot/db";
import { describe, expect, it, vi } from "vitest";
import { getTrustPolicy, setTrustPolicy } from "./trust-policy.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "ws-1",
  email: "test@example.com",
  isDeploymentOwner: false,
};

function depsFor(prisma: Record<string, unknown>, maxToolCallsPerTurn?: number) {
  return { prisma: prisma as unknown as PrismaClient, maxToolCallsPerTurn };
}

describe("getTrustPolicy handler", () => {
  it("returns the safe default plus the deployment default when the space stores none", async () => {
    const deps = depsFor({ space: { findUnique: vi.fn(async () => null) } });
    await expect(getTrustPolicy(deps, actor)).resolves.toEqual({
      approvalThreshold: "medium",
      quietHours: null,
      maxToolCallsPerTurn: null,
      maxToolCallsPerTurnDefault: 0,
    });
  });

  it("reports the stored limit next to the deployment default", async () => {
    const deps = depsFor(
      {
        space: {
          findUnique: vi.fn(async () => ({
            maxToolCallsPerTurn: 200,
            trustPolicy: { approvalThreshold: "medium", quietHours: null },
          })),
        },
      },
      10,
    );

    await expect(getTrustPolicy(deps, actor)).resolves.toEqual({
      approvalThreshold: "medium",
      quietHours: null,
      maxToolCallsPerTurn: 200,
      maxToolCallsPerTurnDefault: 10,
    });
  });
});

describe("setTrustPolicy handler", () => {
  it("persists the policy against the actor's space and reports the deployment default", async () => {
    const upsert = vi.fn(async (_args: unknown) => ({
      approvalThreshold: "low",
      quietHours: null,
    }));
    const update = vi.fn(async (_args: unknown) => ({ maxToolCallsPerTurn: 80 }));
    const transaction = vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations));
    const deps = depsFor(
      { trustPolicy: { upsert }, space: { update }, $transaction: transaction },
      10,
    );

    const policy = await setTrustPolicy(deps, actor, {
      approvalThreshold: "low",
      quietHours: null,
      maxToolCallsPerTurn: 80,
    });

    expect((upsert.mock.calls[0]![0] as { where: unknown }).where).toEqual({ spaceId: "ws-1" });
    // The stored value reaches the repository unchanged.
    expect((update.mock.calls[0]![0] as { data: unknown }).data).toEqual({
      maxToolCallsPerTurn: 80,
    });
    expect(policy.approvalThreshold).toBe("low");
    expect(policy.maxToolCallsPerTurn).toBe(80);
    expect(policy.maxToolCallsPerTurnDefault).toBe(10);
  });
});
