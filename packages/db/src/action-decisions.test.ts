import { describe, expect, it } from "vitest";
import { createDb } from "./client.js";

const databaseAvailable = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!databaseAvailable)("action_decisions append-only", () => {
  it("accepts a decision row and refuses to change one", async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const organizationId = `action-decisions-organization-${suffix}`;
    const spaceId = `action-decisions-space-${suffix}`;
    const db = createDb(process.env.DATABASE_URL!);
    const prisma = db.prisma;
    try {
      await prisma.organization.create({
        data: {
          id: organizationId,
          name: "action-decisions-fixture",
          slug: organizationId,
          createdAt: new Date(),
        },
      });
      await prisma.space.create({
        data: { id: spaceId, organizationId, name: "action-decisions-fixture" },
      });
      const created = await prisma.actionDecision.create({
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
        prisma.actionDecision.update({ where: { id: created.id }, data: { decision: "allow" } }),
      ).rejects.toThrow("action_decisions is append-only");
      await expect(prisma.actionDecision.delete({ where: { id: created.id } })).rejects.toThrow(
        "action_decisions is append-only",
      );
    } finally {
      // Verified against Postgres: a cascade delete from the fixture's parent rows
      // still fires this BEFORE DELETE row trigger, so the append-only guard blocks
      // ordinary teardown too. Drop the trigger, remove the fixture through the
      // cascade, and restore it.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "action_decisions" DISABLE TRIGGER "action_decision_append_only"`,
      );
      try {
        await prisma.organization.deleteMany({ where: { id: organizationId } });
      } finally {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "action_decisions" ENABLE TRIGGER "action_decision_append_only"`,
        );
      }
      await prisma.$disconnect();
      await db.pool.end();
    }
  });
});
