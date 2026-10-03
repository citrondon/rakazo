import { describe, expect, it } from "vitest";
import { createDb } from "./client.js";

const databaseAvailable = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!databaseAvailable)("action_decisions append-only", () => {
  it("accepts a decision row and refuses to change one", async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const organizationId = `action-decisions-organization-${suffix}`;
    const spaceId = `action-decisions-space-${suffix}`;
    // Thrown at the end of the interactive transaction so it never commits; the
    // fixture rows and the two refused writes leave no trace in the database.
    const rollback = Symbol("rollback-fixture-transaction");
    const db = createDb(process.env.DATABASE_URL!);
    const prisma = db.prisma;
    try {
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
          const created = await tx.actionDecision.create({
            data: {
              spaceId,
              botId: "fixture-bot",
              toolName: "fixture_tool",
              connectorKind: "fixture",
              decision: "ask",
              source: "default",
              enforced: false,
              wouldDeny: true,
              matchingRules: [],
            },
          });
          await expect(
            tx.actionDecision.update({ where: { id: created.id }, data: { decision: "allow" } }),
          ).rejects.toThrow("action_decisions is append-only");
          await expect(tx.actionDecision.delete({ where: { id: created.id } })).rejects.toThrow(
            "action_decisions is append-only",
          );
          throw rollback;
        }),
      ).rejects.toBe(rollback);

      // The transaction rolled back, so nothing the fixture wrote is left behind.
      await expect(prisma.organization.count({ where: { id: organizationId } })).resolves.toBe(0);
      await expect(prisma.space.count({ where: { id: spaceId } })).resolves.toBe(0);
      await expect(prisma.actionDecision.count({ where: { spaceId } })).resolves.toBe(0);
    } finally {
      await prisma.$disconnect();
      await db.pool.end();
    }
  });
});
