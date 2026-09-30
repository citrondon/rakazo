import { createDb } from "../packages/db/src/index.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const { prisma, pool } = createDb(databaseUrl);

  try {
    const spaceId = process.env.RAKAZO_SPACE_ID;
    const userId = process.env.RAKAZO_USER_ID;
    if (!spaceId || !userId) {
      console.error("RAKAZO_SPACE_ID and RAKAZO_USER_ID must be set to a local test space.");
      process.exit(1);
    }
    const groupId = "grp_research_intelligence";
    const threadId = "th_grp_research_intelligence";
    const chiefBotId = process.env.RAKAZO_CHIEF_BOT_ID ?? "";

    const promptText =
      "@Chief bitte prüfe die von OpenResearch erstellte Spezifikation 'research/trending-agent-spec.md' und das von GrokCoder implementierte Tool 'tools/trending_monitor.py'. Das Tool wurde im Terminal via MCP run_process ('python3 tools/trending_monitor.py hn -n 3') mit Exit-Code 0 erfolgreich getestet. Gib eine kurze, prägnante Zusammenfassung und Bestätigung des Meilensteins im Chat ab.";

    const thread = await prisma.thread.findUniqueOrThrow({ where: { id: threadId } });
    const seq = thread.nextMessageSeq;

    await prisma.thread.update({
      where: { id: threadId },
      data: {
        nextMessageSeq: seq + 1,
        nextEventSeq: thread.nextEventSeq + 1,
      },
    });

    const stamp = Date.now().toString(36);
    const msgId = `msg_chief_${stamp}`;
    const taskId = `task_chief_${stamp}`;
    const runId = `run_chief_${stamp}`;

    const task = await prisma.task.create({
      data: {
        id: taskId,
        spaceId,
        botId: chiefBotId,
        threadId,
        userId,
        prompt: promptText,
        status: "queued",
      },
    });

    const run = await prisma.run.create({
      data: {
        id: runId,
        spaceId,
        botId: chiefBotId,
        threadId,
        taskId: task.id,
        userId,
        status: "queued",
        trigger: "user",
        modelProvider: "openai-compatible",
        modelId: "claude-sonnet-5",
        clientNonce: `send:${msgId}:${chiefBotId}`,
      },
    });

    const message = await prisma.message.create({
      data: {
        id: msgId,
        threadId,
        seq,
        role: "user",
        blocks: [{ kind: "text", text: promptText }],
        runId: run.id,
      },
    });

    await prisma.run.update({
      where: { id: run.id },
      data: { sourceMessageId: message.id },
    });

    await pool.query(
      `SELECT graphile_worker.add_job('run.continue', json_build_object('runId', $1::text));`,
      [run.id],
    );

    console.log(`Chief review run ${run.id} enqueued. Waiting for completion...`);

    let lastStatus = "queued";
    const start = Date.now();
    while (Date.now() - start < 120000) {
      await new Promise((r) => setTimeout(r, 3000));
      const currentRun = await prisma.run.findUnique({
        where: { id: run.id },
      });

      if (currentRun && currentRun.status !== lastStatus) {
        lastStatus = currentRun.status;
        console.log(`Status: ${lastStatus}`);
      }

      if (currentRun && (currentRun.status === "completed" || currentRun.status === "failed")) {
        if (currentRun.status === "completed") {
          const reply = await prisma.message.findFirst({
            where: { runId: run.id, role: "assistant" },
            orderBy: { seq: "desc" },
          });
          if (reply) {
            const textBlock = reply.blocks.find((b: any) => b.kind === "text");
            console.log("\nChief Review:\n", textBlock ? (textBlock as any).text : "");
          }
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
