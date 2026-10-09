import type { TriggerEvent } from "@bobbot/contracts";
import { selectTriggeredRoutines } from "@bobbot/core";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, type PrismaClient } from "./client.js";
import { createTriggerRepos } from "./triggers.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("trigger journey (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const userId = `trigger-journey-user-${suffix}`;
  const organizationId = `trigger-journey-org-${suffix}`;
  const spaceId = organizationId;
  const botId = `trigger-journey-bot-${suffix}`;
  let prisma: PrismaClient;
  let close: () => Promise<void>;

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await close();
  });

  it("stores a routine trigger that wakes the routine only on a matching event", async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };

    const createdAt = new Date();
    await prisma.user.create({
      data: {
        id: userId,
        name: "Trigger Journey",
        email: `${userId}@rakazo.test`,
        emailVerified: false,
      },
    });
    await prisma.organization.create({
      data: { id: organizationId, name: "Trigger Journey", slug: organizationId, createdAt },
    });
    await prisma.space.create({
      data: {
        id: spaceId,
        organizationId,
        name: "General",
        isDefault: true,
        createdByUserId: userId,
      },
    });
    await prisma.member.create({
      data: {
        id: `trigger-journey-member-${suffix}`,
        organizationId,
        userId,
        role: "member",
        createdAt,
      },
    });
    await prisma.bot.create({
      data: { id: botId, spaceId, userId, name: "Scout", color: "graphite" },
    });
    const routine = await prisma.routine.create({
      data: {
        spaceId,
        botId,
        userId,
        name: "Bug triage",
        prompt: "Triage the issue.",
        crons: [],
        timezone: "UTC",
        active: true,
      },
    });

    const actor = {
      userId,
      spaceId,
      email: `${userId}@rakazo.test`,
      isDeploymentOwner: false,
    };
    const repos = createTriggerRepos(prisma);
    const trigger = await repos.createTrigger(actor, {
      routineId: routine.id,
      source: "connector",
      provider: "github",
      eventType: "issues",
      filter: {
        predicates: [
          { field: "payload.action", operator: "equals", value: "opened", caseSensitive: false },
        ],
      },
      mappings: [{ from: "payload.issue.title", to: "title" }],
      enabled: true,
    });
    expect(trigger.botId).toBe(botId);

    const stored = await repos.listEnabledTriggersForEvent({
      spaceId,
      botId,
      provider: "github",
      eventType: "issues",
    });
    expect(stored.map((entry) => entry.id)).toEqual([trigger.id]);

    const candidates = [{ routineId: routine.id, name: routine.name, prompt: routine.prompt }];
    const event: TriggerEvent = {
      source: "connector",
      provider: "github",
      type: "issues",
      payload: { action: "opened", issue: { title: "Crash on boot" } },
    };
    const selected = selectTriggeredRoutines(candidates, stored, event);
    expect(selected).toHaveLength(1);
    expect(selected[0]!.prompt).toContain("title: Crash on boot");

    const unrelated = selectTriggeredRoutines(candidates, stored, {
      ...event,
      payload: { action: "closed", issue: { title: "Crash on boot" } },
    });
    expect(unrelated).toEqual([]);
  });
});
