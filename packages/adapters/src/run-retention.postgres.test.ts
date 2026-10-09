import { ACTIVE_RUN_STATUSES } from "@bobbot/core";
import { createDb, type PrismaClient } from "@bobbot/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pruneRunHistory } from "./run-retention.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

/** One organization, space, bot and thread per suite; runs are the rows the pruner owns. */
async function seedFixture(prisma: PrismaClient) {
  const suffix = Date.now().toString(36);
  const organization = await prisma.organization.create({
    data: {
      id: `ret-org-${suffix}`,
      name: "Retention Org",
      slug: `ret-${suffix}`,
      createdAt: new Date(),
    },
  });
  const user = await prisma.user.create({
    data: {
      id: `ret-user-${suffix}`,
      email: `retention-${suffix}@example.test`,
      name: "Retention",
    },
  });
  await prisma.member.create({
    data: {
      id: `ret-member-${suffix}`,
      organizationId: organization.id,
      userId: user.id,
      role: "member",
      createdAt: new Date(),
    },
  });
  const space = await prisma.space.create({
    data: {
      id: `ret-space-${suffix}`,
      organizationId: organization.id,
      name: "Retention",
      createdByUserId: user.id,
    },
  });
  await prisma.spaceMember.create({
    data: {
      id: `ret-sm-${suffix}`,
      spaceId: space.id,
      organizationId: organization.id,
      userId: user.id,
      role: "owner",
      createdAt: new Date(),
    },
  });
  const bot = await prisma.bot.create({
    data: {
      spaceId: space.id,
      userId: user.id,
      name: "Chief",
      color: "#000000",
      thread: { create: { spaceId: space.id, userId: user.id } },
    },
  });
  const thread = await prisma.thread.findFirstOrThrow({ where: { botId: bot.id } });
  return { organization, space, user, bot, thread };
}

async function seedRun(
  prisma: PrismaClient,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  overrides: {
    status?: string;
    updatedAt: Date;
    usage?: { inputTokens: number; outputTokens: number };
    events?: number;
  },
) {
  const task = await prisma.task.create({
    data: {
      spaceId: fixture.space.id,
      botId: fixture.bot.id,
      threadId: fixture.thread.id,
      userId: fixture.user.id,
      prompt: "seed",
      status: "completed",
    },
  });
  const run = await prisma.run.create({
    data: {
      spaceId: fixture.space.id,
      botId: fixture.bot.id,
      threadId: fixture.thread.id,
      taskId: task.id,
      userId: fixture.user.id,
      status: overrides.status ?? "completed",
      trigger: "routine",
      updatedAt: overrides.updatedAt,
    },
  });
  if (overrides.usage) {
    await prisma.usageRecord.create({
      data: {
        spaceId: fixture.space.id,
        botId: fixture.bot.id,
        userId: fixture.user.id,
        runId: run.id,
        provider: "test",
        model: "test-model",
        inputTokens: overrides.usage.inputTokens,
        outputTokens: overrides.usage.outputTokens,
      },
    });
  }
  for (let index = 0; index < (overrides.events ?? 0); index += 1) {
    await prisma.event.create({
      data: {
        spaceId: fixture.space.id,
        threadId: fixture.thread.id,
        botId: fixture.bot.id,
        seq: index + 1,
        type: "thread.progress",
        payload: {},
        runId: run.id,
      },
    });
  }
  return run;
}

describePostgres("run history retention", () => {
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;
  let fixture: Awaited<ReturnType<typeof seedFixture>>;

  const old = () => new Date(Date.now() - 200 * 24 * 60 * 60_000);
  const recent = () => new Date(Date.now() - 3 * 24 * 60 * 60_000);

  beforeAll(async () => {
    db = createDb(databaseUrl!);
    prisma = db.prisma;
    fixture = await seedFixture(prisma);
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: fixture.organization.id } });
    await db.pool.end();
    await prisma.$disconnect();
  });

  it("deletes a finished run past the window but not a recent one", async () => {
    const stale = await seedRun(prisma, fixture, { updatedAt: old() });
    const fresh = await seedRun(prisma, fixture, { updatedAt: recent() });
    await pruneRunHistory(prisma);
    expect(await prisma.run.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(await prisma.run.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });

  it("spares active runs regardless of age", async () => {
    for (const status of ACTIVE_RUN_STATUSES) {
      const parked = await seedRun(prisma, fixture, { status, updatedAt: old() });
      await pruneRunHistory(prisma);
      expect(await prisma.run.findUnique({ where: { id: parked.id } })).not.toBeNull();
      await prisma.run.delete({ where: { id: parked.id } });
    }
  });

  it("keeps spend counts after the run is gone", async () => {
    await seedRun(prisma, fixture, {
      updatedAt: old(),
      usage: { inputTokens: 900, outputTokens: 120 },
    });
    await pruneRunHistory(prisma);
    // The release turns `runId` null, so the row is found by its space and model, not by
    // the run it once served.
    const usage = await prisma.usageRecord.findFirst({
      where: { spaceId: fixture.space.id, model: "test-model" },
    });
    // The row survives with its attribution intact and its run link released, exactly
    // what the schema comment promises: spend really happened.
    expect(usage).not.toBeNull();
    expect(usage?.botId).toBe(fixture.bot.id);
    expect(usage?.runId).toBeNull();
    expect(usage?.inputTokens).toBe(900);
    expect(usage?.outputTokens).toBe(120);
  });

  it("leaves transcript events in place when the run goes", async () => {
    const chatty = await seedRun(prisma, fixture, { updatedAt: old(), events: 3 });
    await pruneRunHistory(prisma);
    expect(await prisma.run.findUnique({ where: { id: chatty.id } })).toBeNull();
    const remaining = await prisma.event.count({ where: { runId: chatty.id } });
    expect(remaining).toBe(3);
  });

  it("reports how many runs it removed", async () => {
    for (let index = 0; index < 3; index += 1) {
      await seedRun(prisma, fixture, { updatedAt: old() });
    }
    await expect(pruneRunHistory(prisma)).resolves.toBeGreaterThanOrEqual(3);
  });
});
