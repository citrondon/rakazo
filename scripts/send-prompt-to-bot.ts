import { createDb } from "../packages/db/src/index.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const botName = process.argv[2] || "ExecutiveChief";
  const userPrompt =
    process.argv[3] ||
    "Analysiere meinen E-Mail-Posteingang und hilf mir beim Aufräumen: Prüfe alle aktuellen E-Mails (z. B. via 'python3 /home/rakazo/shared/tools/google_assistant.py mail -n 10 -f json' oder Browser), kategorisiere sie nach Wichtigkeit (Dringend/Wichtig, Info, Newsletter, Spam) und erstelle einen konkreten Aufräum- und Aktionsplan für mich mit Checkboxen und Empfehlungen.";

  const { prisma, pool } = createDb(databaseUrl);

  try {
    const bot = await prisma.bot.findFirstOrThrow({
      where: { name: botName },
    });

    console.log(`Sending prompt to bot "${bot.name}" (ID: ${bot.id})...`);
    console.log(`Prompt: "${userPrompt}"`);

    // Ensure thread exists for bot
    let thread = await prisma.thread.findUnique({
      where: { botId: bot.id },
    });

    if (!thread) {
      thread = await prisma.thread.create({
        data: {
          spaceId: bot.spaceId,
          userId: bot.userId,
          botId: bot.id,
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
    const msgId = `msg_user_${stamp}`;
    const taskId = `task_user_${stamp}`;
    const runId = `run_user_${stamp}`;

    const task = await prisma.task.create({
      data: {
        id: taskId,
        spaceId: bot.spaceId,
        botId: bot.id,
        threadId: thread.id,
        userId: bot.userId,
        prompt: userPrompt,
        status: "queued",
      },
    });

    const run = await prisma.run.create({
      data: {
        id: runId,
        spaceId: bot.spaceId,
        botId: bot.id,
        threadId: thread.id,
        taskId: task.id,
        userId: bot.userId,
        status: "queued",
        trigger: "chat",
        modelProvider: "openai-compatible",
        modelId: "claude-sonnet-5",
        clientNonce: `chat:${bot.id}:${stamp}`,
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

    // Enqueue job to Graphile worker
    console.log(`Enqueued chat run ${run.id}. Waiting for completion...`);
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
        console.log(`Run status: ${lastStatus}`);
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
            console.log(`${bot.name} Antwort:\n`);
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
