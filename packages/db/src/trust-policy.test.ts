import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { createTrustPolicyRepos } from "./trust-policy.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "ws-1",
  email: "test@example.com",
  isDeploymentOwner: false,
};

const night = { start: "22:00", end: "07:00", timezone: "Europe/Berlin" };

function policyRow(overrides: Record<string, unknown> = {}) {
  return { approvalThreshold: "high", quietHours: night, ...overrides };
}

function reposFor(prisma: Record<string, unknown>) {
  return createTrustPolicyRepos(prisma as unknown as PrismaClient);
}

describe("createTrustPolicyRepos.getTrustPolicy", () => {
  it("reads the actor's space policy and maps it", async () => {
    const findUnique = vi.fn(async (_args: unknown) => policyRow());
    const repos = reposFor({ trustPolicy: { findUnique } });

    const policy = await repos.getTrustPolicy(actor);

    expect(findUnique.mock.calls[0]![0]).toEqual({
      where: { spaceId: "ws-1" },
      select: { approvalThreshold: true, quietHours: true },
    });
    expect(policy).toEqual({ approvalThreshold: "high", quietHours: night });
  });

  it("falls back to the safe default when the space has no policy", async () => {
    const repos = reposFor({ trustPolicy: { findUnique: vi.fn(async () => null) } });
    await expect(repos.getTrustPolicy(actor)).resolves.toEqual({
      approvalThreshold: "medium",
      quietHours: null,
    });
  });
});

describe("createTrustPolicyRepos.setTrustPolicy", () => {
  it("upserts scoped to the actor's space and records the author", async () => {
    const upsert = vi.fn(async (_args: unknown) => policyRow());
    const repos = reposFor({ trustPolicy: { upsert } });

    await repos.setTrustPolicy(actor, { approvalThreshold: "high", quietHours: night });

    const args = upsert.mock.calls[0]![0] as {
      where: unknown;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.where).toEqual({ spaceId: "ws-1" });
    expect(args.create).toMatchObject({
      spaceId: "ws-1",
      createdByUserId: "user-1",
      approvalThreshold: "high",
    });
    expect(args.update).toMatchObject({ approvalThreshold: "high" });
  });

  it("writes a database null when quiet hours are cleared, not an absent field", async () => {
    const upsert = vi.fn(async (_args: unknown) => policyRow({ quietHours: null }));
    const repos = reposFor({ trustPolicy: { upsert } });

    const policy = await repos.setTrustPolicy(actor, {
      approvalThreshold: "medium",
      quietHours: null,
    });

    const args = upsert.mock.calls[0]![0] as { update: Record<string, unknown> };
    expect(args.update).toHaveProperty("quietHours");
    expect(args.update.quietHours).not.toBeUndefined();
    expect(policy.quietHours).toBeNull();
  });
});
