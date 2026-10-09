import type { Actor } from "@bobbot/contracts";
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

function spaceRow(overrides: Record<string, unknown> = {}) {
  return { maxToolCallsPerTurn: 200, trustPolicy: policyRow(), ...overrides };
}

function reposFor(prisma: Record<string, unknown>) {
  return createTrustPolicyRepos(prisma as unknown as PrismaClient);
}

describe("createTrustPolicyRepos.getTrustPolicy", () => {
  it("reads the space row and its optional policy in one query", async () => {
    const findUnique = vi.fn(async (_args: unknown) => spaceRow());
    const repos = reposFor({ space: { findUnique } });

    const policy = await repos.getTrustPolicy({ spaceId: "ws-1" });

    expect(findUnique.mock.calls[0]![0]).toEqual({
      where: { id: "ws-1" },
      select: {
        maxToolCallsPerTurn: true,
        trustPolicy: { select: { approvalThreshold: true, quietHours: true } },
      },
    });
    expect(policy).toEqual({
      approvalThreshold: "high",
      quietHours: night,
      maxToolCallsPerTurn: 200,
    });
  });

  it("keeps a stored 0 as unlimited instead of treating it as absent", async () => {
    const repos = reposFor({
      space: { findUnique: vi.fn(async () => spaceRow({ maxToolCallsPerTurn: 0 })) },
    });

    await expect(repos.getTrustPolicy({ spaceId: "ws-1" })).resolves.toEqual({
      approvalThreshold: "high",
      quietHours: night,
      maxToolCallsPerTurn: 0,
    });
  });

  it("reports null when the space stores no limit of its own", async () => {
    const repos = reposFor({
      space: { findUnique: vi.fn(async () => spaceRow({ maxToolCallsPerTurn: null })) },
    });

    const policy = await repos.getTrustPolicy({ spaceId: "ws-1" });
    expect(policy.maxToolCallsPerTurn).toBeNull();
  });

  it("still reports the column when the space has no policy row", async () => {
    const repos = reposFor({
      space: { findUnique: vi.fn(async () => spaceRow({ trustPolicy: null })) },
    });

    await expect(repos.getTrustPolicy({ spaceId: "ws-1" })).resolves.toEqual({
      approvalThreshold: "medium",
      quietHours: null,
      maxToolCallsPerTurn: 200,
    });
  });

  it("falls back to the safe default when the space is unknown", async () => {
    const repos = reposFor({ space: { findUnique: vi.fn(async () => null) } });

    await expect(repos.getTrustPolicy({ spaceId: "ws-1" })).resolves.toEqual({
      approvalThreshold: "medium",
      quietHours: null,
      maxToolCallsPerTurn: null,
    });
  });
});

describe("createTrustPolicyRepos.setTrustPolicy", () => {
  function writeRepos(storedSpace: Record<string, unknown>, storedPolicy = policyRow()) {
    const upsert = vi.fn(async (_args: unknown) => storedPolicy);
    const update = vi.fn(async (_args: unknown) => storedSpace);
    const transaction = vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations));
    return {
      upsert,
      update,
      transaction,
      repos: reposFor({ trustPolicy: { upsert }, space: { update }, $transaction: transaction }),
    };
  }

  it("writes both tables in one transaction scoped to the actor's space", async () => {
    const { upsert, update, transaction, repos } = writeRepos({ maxToolCallsPerTurn: 0 });

    const policy = await repos.setTrustPolicy(actor, {
      approvalThreshold: "high",
      quietHours: night,
      maxToolCallsPerTurn: 0,
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    const upsertArgs = upsert.mock.calls[0]![0] as {
      where: unknown;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(upsertArgs.where).toEqual({ spaceId: "ws-1" });
    expect(upsertArgs.create).toMatchObject({
      spaceId: "ws-1",
      createdByUserId: "user-1",
      approvalThreshold: "high",
    });
    expect(upsertArgs.update).toMatchObject({ approvalThreshold: "high" });

    const updateArgs = update.mock.calls[0]![0] as { where: unknown; data: unknown };
    expect(updateArgs.where).toEqual({ id: "ws-1" });
    // A stored 0 must reach the column as 0, not be filtered out as falsy.
    expect(updateArgs.data).toEqual({ maxToolCallsPerTurn: 0 });
    expect(policy).toEqual({
      approvalThreshold: "high",
      quietHours: night,
      maxToolCallsPerTurn: 0,
    });
  });

  it("clears the column when the input stores null", async () => {
    const { update, repos } = writeRepos({ maxToolCallsPerTurn: null });

    const policy = await repos.setTrustPolicy(actor, {
      approvalThreshold: "medium",
      quietHours: null,
      maxToolCallsPerTurn: null,
    });

    const updateArgs = update.mock.calls[0]![0] as { data: unknown };
    expect(updateArgs.data).toEqual({ maxToolCallsPerTurn: null });
    expect(policy.maxToolCallsPerTurn).toBeNull();
  });

  it("writes a database null when quiet hours are cleared, not an absent field", async () => {
    const { upsert, repos } = writeRepos(
      { maxToolCallsPerTurn: null },
      policyRow({ quietHours: null }),
    );

    const policy = await repos.setTrustPolicy(actor, {
      approvalThreshold: "medium",
      quietHours: null,
      maxToolCallsPerTurn: null,
    });

    const args = upsert.mock.calls[0]![0] as { update: Record<string, unknown> };
    expect(args.update).toHaveProperty("quietHours");
    expect(args.update.quietHours).not.toBeUndefined();
    expect(policy.quietHours).toBeNull();
  });
});
