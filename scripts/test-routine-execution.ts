import { createDb } from "../packages/db/src/index.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const { prisma, pool } = createDb(databaseUrl);

  try {
    const routineId = process.argv[2] || "cmujsli9i000kswpcp098ixce"; // Standard: ExecutiveChief Morgen-Briefing
    const routine = await prisma.routine.findUniqueOrThrow({
      where: { id: routineId },
      include: { bot: true },
    });

    console.log(`Starting routine "${routine.name}" for ${routine.bot.name}...`);
    console.log(`Prompt: "${routine.prompt}"`);

    // Ensure thread exists for bot
    let thread = await prisma.thread.findUnique({
      where: { botId: routine.botId },
    });

    if (!thread) {
      thread = await prisma.thread.create({
        data: {
          spaceId: routine.spaceId,
          userId: routine.userId,
          botId: routine.botId,
        },
      });
    }

    const seq = thread.nextMessageSeq;
    await prisma.thread.update({
      where: { id: thread.id },
      data: {
        nextMessageSeq: seq + 1,
        nextEventSeq: thread.nextEventSeq + 1,
      },
    });

    const stamp = Date.now().toString(36);
    const msgId = `msg_rt_${stamp}`;
    const taskId = `task_rt_${stamp}`;
    const runId = `run_rt_${stamp}`;

    const task = await prisma.task.create({
      data: {
        id: taskId,
        spaceId: routine.spaceId,
        botId: routine.botId,
        threadId: thread.id,
        userId: routine.userId,
        prompt: routine.prompt,
        status: "queued",
      },
    });

    const run = await prisma.run.create({
      data: {
        id: runId,
        spaceId: routine.spaceId,
        botId: routine.botId,
        threadId: thread.id,
        taskId: task.id,
        routineId: routine.id,
        userId: routine.userId,
        status: "queued",
        trigger: "routine",
        modelProvider: "openai-compatible",
        modelId: "claude-sonnet-5",
        clientNonce: `routine:${routine.id}:${stamp}`,
      },
    });

    const message = await prisma.message.create({
      data: {
        id: msgId,
        threadId: thread.id,
        seq,
        role: "user",
        blocks: [{ kind: "text", text: `[Routine: ${routine.name}]\n${routine.prompt}` }],
        runId: run.id,
      },
    });

    await prisma.run.update({
      where: { id: run.id },
      data: { sourceMessageId: message.id },
    });

    await prisma.routine.update({
      where: { id: routine.id },
      data: { lastRunAt: new Date() },
    });

    // Enqueue job to Graphile worker
    console.log(`Enqueued routine run ${run.id}. Waiting for completion...`);
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
        console.log(`Routine run status: ${lastStatus}`);
      }

      if (currentRun && (currentRun.status === "completed" || currentRun.status === "failed")) {
        if (currentRun.status === "completed") {
          const reply = await prisma.message.findFirst({
            where: { runId: run.id, role: "assistant" },
            orderBy: { seq: "desc" },
          });
          if (reply) {
            const textBlock = reply.blocks.find((b: any) => b.kind === "text");
            console.log("\n=======================================================");
            console.log("TrendScout Routine Output:\n");
            console.log(textBlock ? (textBlock as any).text : "[Non-text response]");
            console.log("=======================================================");
          }
        } else {
          console.error("Routine run failed:", currentRun.error);
        }
        break;
      }
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch(console.error);
