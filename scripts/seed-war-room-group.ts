import { createDb } from "../packages/db/src/index.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const { prisma, pool } = createDb(databaseUrl);

  try {
    console.log("Seeding GrokBot Team War Room group...");

    // Find bots
    const targetBotNames = ["ExecutiveChief", "GrokCoder", "TrendScout", "DataAnalyst"];
    const bots = await prisma.bot.findMany({
      where: { name: { in: targetBotNames } },
    });

    if (bots.length === 0) {
      throw new Error("No target bots found in database.");
    }

    console.log(`Found ${bots.length} bots: ${bots.map((b) => b.name).join(", ")}`);

    const spaceId = bots[0]!.spaceId;
    const userId = bots[0]!.userId;

    const groupId = "grp_grokbot_war_room";
    const groupName = "GrokBot Team War Room";

    // Upsert ChatGroup
    const group = await prisma.chatGroup.upsert({
      where: { id: groupId },
      update: {
        name: groupName,
        pinned: true,
      },
      create: {
        id: groupId,
        spaceId,
        userId,
        name: groupName,
        pinned: true,
      },
    });

    console.log(`Group "${group.name}" (ID: ${group.id}) ready.`);

    // Upsert members
    for (const bot of bots) {
      await prisma.chatGroupMember.upsert({
        where: {
          groupId_botId: {
            groupId: group.id,
            botId: bot.id,
          },
        },
        update: {},
        create: {
          groupId: group.id,
          botId: bot.id,
        },
      });
      console.log(`- Added member: ${bot.name} (${bot.id})`);
    }

    // Ensure Group Thread
    let thread = await prisma.thread.findUnique({
      where: { groupId: group.id },
    });

    if (!thread) {
      thread = await prisma.thread.create({
        data: {
          id: `th_${groupId}`,
          spaceId,
          userId,
          groupId: group.id,
        },
      });
      console.log(`Created thread for group: ${thread.id}`);
    } else {
      console.log(`Thread for group already exists: ${thread.id}`);
    }

    console.log("\n✅ GrokBot Team War Room successfully seeded!");
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
