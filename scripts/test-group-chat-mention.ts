import { createDb } from "../packages/db/src/index.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const userPrompt =
    process.argv[2] ||
    "@TrendScout Fasse kurz die Top 3 Tech-Trends von heute zusammen und gib eine Empfehlung für das Team.";

  const { prisma, pool } = createDb(databaseUrl);

  try {
    const groupId = "grp_grokbot_war_room";
    const group = await prisma.chatGroup.findUniqueOrThrow({
      where: { id: groupId },
      include: {
        members: {
          include: { bot: true },
        },
        thread: true,
      },
    });

    console.log(`Connecting to "${group.name}" with ${group.members.length} members...`);

    // Parse mention
    let targetBot = group.members.find((m) =>
      userPrompt.toLowerCase().includes(`@${m.bot.name.toLowerCase()}`),
    )?.bot;

    // Default to ExecutiveChief if no explicit mention
    if (!targetBot) {
      targetBot = group.members.find((m) => m.bot.name === "ExecutiveChief")?.bot;
    }

    if (!targetBot) {
      throw new Error("Could not determine responding bot for group message.");
    }

    console.log(`Target bot selected: ${targetBot.name} (${targetBot.id})`);

    const thread = group.thread!;
    const seq = thread.nextMessageSeq;

    await prisma.thread.update({
      where: { id: thread.id },
      data: {
        nextMessageSeq: seq + 1,
        nextEventSeq: thread.nextEventSeq + 1,
      },
    });

    const stamp = Date.now().toString(36);
    const msgId = `msg_grp_${stamp}`;
    const taskId = `task_grp_${stamp}`;
    const runId = `run_grp_${stamp}`;

    const task = await prisma.task.create({
      data: {
        id: taskId,
        spaceId: group.spaceId,
        botId: targetBot.id,
        threadId: thread.id,
        userId: group.userId,
        prompt: userPrompt,
        status: "queued",
      },
    });

    const run = await prisma.run.create({
      data: {
        id: runId,
        spaceId: group.spaceId,
        botId: targetBot.id,
        threadId: thread.id,
        taskId: task.id,
        userId: group.userId,
        status: "queued",
        trigger: "chat",
        modelProvider: "openai-compatible",
        modelId: "claude-sonnet-5",
        clientNonce: `group:${groupId}:${targetBot.id}:${stamp}`,
      },
    });

    const message = await prisma.message.create({
      data: {
        id: msgId,
        threadId: thread.id,
        seq,
        role: "user",
        blocks: [{ kind: "text", text: userPrompt }],
        runId: run.id,
      },
    });

    await prisma.run.update({
      where: { id: run.id },
      data: { sourceMessageId: message.id },
    });

    console.log(`Enqueued run ${run.id} for ${targetBot.name} in War Room. Waiting...`);
    await pool.query(
      `SELECT graphile_worker.add_job('run.continue', json_build_object('runId', $1::text));`,
      [run.id],
    );

    let lastStatus = "queued";
    const start = Date.now();
    while (Date.now() - start < 180000) {
      await new Promise((r) => setTimeout(r, 4000));
      const currentRun = await prisma.run.findUnique({
        where: { id: run.id },
      });

      if (currentRun && currentRun.status !== lastStatus) {
        lastStatus = currentRun.status;
        console.log(`War Room Run Status: ${lastStatus}`);
      }

      if (currentRun && (currentRun.status === "completed" || currentRun.status === "failed")) {
        if (currentRun.status === "completed") {
          const reply = await prisma.message.findFirst({
            where: { runId: run.id, role: "bot" },
            orderBy: { seq: "desc" },
          });
          if (reply) {
            const textBlock = reply.blocks.find((b: any) => b.kind === "text");
            console.log("\n=======================================================");
            console.log(`[War Room] ${targetBot.name} Antwort:\n`);
            console.log(textBlock ? (textBlock as any).text : "[Non-text response]");
            console.log("=======================================================");
          }
        } else {
          console.error("Run failed:", currentRun.error);
        }
        break;
      }
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
