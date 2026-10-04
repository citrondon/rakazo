import { describe, expect, it } from "vitest";
import { createDb } from "./client.js";

const databaseAvailable = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);

// Prisma echoes the source lines around the failed invocation into its error
// message. Asserting the trigger text through this constant, never inline near
// a refused call, means a matching message can only have come from the database.
const appendOnly = "action_decisions is append-only";

function decisionData(spaceId: string) {
  return {
    spaceId,
    botId: "fixture-bot",
    toolName: "fixture_tool",
    connectorKind: "fixture",
    decision: "ask",
    source: "default",
    enforced: false,
    wouldDeny: true,
    matchingRules: [],
  };
}

describe.skipIf(!databaseAvailable)("action_decisions append-only", () => {
  it("refuses update and delete, each in its own rolled-back transaction", async () => {
    const db = createDb(process.env.DATABASE_URL!);
    const prisma = db.prisma;
    const stamp = `${process.pid}-${Date.now()}`;
    const orgA = `action-decisions-organization-update-${stamp}`;
    const spaceA = `action-decisions-space-update-${stamp}`;
    const orgB = `action-decisions-organization-delete-${stamp}`;
    const spaceB = `action-decisions-space-delete-${stamp}`;
    // Thrown at the end of each interactive transaction so neither ever commits.
    const rollback = Symbol("rollback-fixture-transaction");
    try {
      // A refused write aborts the whole PostgreSQL transaction, so update and
      // delete cannot share one: each refusal gets its own transaction and its
      // own fixture rows, and each transaction is rolled back.
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.organization.create({
            data: { id: orgA, name: "action-decisions-fixture", slug: orgA, createdAt: new Date() },
          });
          await tx.space.create({
            data: { id: spaceA, organizationId: orgA, name: "action-decisions-fixture" },
          });
          const created = await tx.actionDecision.create({ data: decisionData(spaceA) });
          await expect(
            tx.actionDecision.update({ where: { id: created.id }, data: { decision: "allow" } }),
          ).rejects.toThrow(appendOnly);
          throw rollback;
        }),
      ).rejects.toBe(rollback);

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.organization.create({
            data: { id: orgB, name: "action-decisions-fixture", slug: orgB, createdAt: new Date() },
          });
          await tx.space.create({
            data: { id: spaceB, organizationId: orgB, name: "action-decisions-fixture" },
          });
          const created = await tx.actionDecision.create({ data: decisionData(spaceB) });
          await expect(tx.actionDecision.delete({ where: { id: created.id } })).rejects.toThrow(
            appendOnly,
          );
          throw rollback;
        }),
      ).rejects.toBe(rollback);

      // Read outside any transaction. Counting the synthetic ids proves that this
      // fixture left nothing behind; it says nothing about rows of other writers.
      for (const [organizationId, spaceId] of [
        [orgA, spaceA],
        [orgB, spaceB],
      ]) {
        await expect(prisma.organization.count({ where: { id: organizationId } })).resolves.toBe(0);
        await expect(prisma.space.count({ where: { id: spaceId } })).resolves.toBe(0);
        await expect(prisma.actionDecision.count({ where: { spaceId } })).resolves.toBe(0);
      }
    } finally {
      await prisma.$disconnect();
      await db.pool.end();
    }
  });

  it("lets a space be deleted while its recorded decisions survive", async () => {
    const db = createDb(process.env.DATABASE_URL!);
    const prisma = db.prisma;
    const stamp = `${process.pid}-${Date.now()}`;
    const organizationId = `action-decisions-organization-space-${stamp}`;
    const spaceId = `action-decisions-space-space-${stamp}`;
    // Thrown at the end of the interactive transaction so it never commits.
    const rollback = Symbol("rollback-fixture-transaction");
    try {
      // Space deletion must coexist with the append-only audit: spaceId carries no
      // foreign key, so deleting the space neither cascades into the table (which
      // would fire the DELETE trigger and break the lifecycle flow) nor removes
      // the audit. The decision row outlives the space.
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.organization.create({
            data: {
              id: organizationId,
              name: "action-decisions-fixture",
              slug: organizationId,
              createdAt: new Date(),
            },
          });
          await tx.space.create({
            data: { id: spaceId, organizationId, name: "action-decisions-fixture" },
          });
          await tx.actionDecision.create({ data: decisionData(spaceId) });
          await tx.space.delete({ where: { id: spaceId } });
          await expect(tx.actionDecision.count({ where: { spaceId } })).resolves.toBe(1);
          throw rollback;
        }),
      ).rejects.toBe(rollback);

      await expect(prisma.organization.count({ where: { id: organizationId } })).resolves.toBe(0);
      await expect(prisma.space.count({ where: { id: spaceId } })).resolves.toBe(0);
      await expect(prisma.actionDecision.count({ where: { spaceId } })).resolves.toBe(0);
    } finally {
      await prisma.$disconnect();
      await db.pool.end();
    }
  });
});
