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
    const botId = process.env.RAKAZO_RESEARCH_BOT_ID ?? ""; // OpenResearch
    const threadId = "th_grp_research_intelligence";

    const promptText =
      "@OpenResearch recherchiere bitte die neuesten Trends zu Open-Source MCP Servern unter https://github.com/punkpeye/awesome-mcp-servers und fasse die 5 wichtigsten Kategorien zusammen. Speichere das Ergebnis als 'research/mcp-trends.md' im gemeinsamen Workspace.";

    // Ensure thread exists
    let thread = await prisma.thread.findUnique({ where: { id: threadId } });
    if (!thread) {
      thread = await prisma.thread.create({
        data: {
          id: threadId,
          spaceId,
          userId,
          groupId,
        },
      });
    }

    const seq = thread.nextMessageSeq;
    await prisma.thread.update({
      where: { id: threadId },
      data: {
        nextMessageSeq: seq + 1,
        nextEventSeq: thread.nextEventSeq + 1,
      },
    });

    const stamp = Date.now().toString(36);
    const msgId = `msg_res_${stamp}`;
    const taskId = `task_res_${stamp}`;
    const runId = `run_res_${stamp}`;

    const task = await prisma.task.create({
      data: {
        id: taskId,
        spaceId,
        botId,
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
        botId,
        threadId,
        taskId: task.id,
        userId,
        status: "queued",
        trigger: "user",
        modelProvider: "openai-compatible",
        modelId: "claude-sonnet-5",
        clientNonce: `send:${msgId}:${botId}`,
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

    // Enqueue job to Graphile worker
    console.log(`Enqueueing run ${run.id} to Graphile worker...`);
    await pool.query(
      `SELECT graphile_worker.add_job('run.continue', json_build_object('runId', $1::text));`,
      [run.id],
    );

    console.log(`Research run ${run.id} triggered! Waiting for completion...`);

    let completed = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const currentRun = await prisma.run.findUnique({
        where: { id: run.id },
        select: { status: true, error: true, completedAt: true },
      });
      console.log(`[${i * 3}s] Run status: ${currentRun?.status}`);
      if (currentRun?.status === "completed") {
        completed = true;
        console.log("Run completed successfully!");
        break;
      }
      if (currentRun?.status === "failed") {
        console.error("Run failed:", currentRun.error);
        break;
      }
    }

    // Retrieve bot reply messages
    const botMessages = await prisma.message.findMany({
      where: { threadId, role: "bot" },
      orderBy: { createdAt: "desc" },
      take: 2,
    });
    for (const m of botMessages) {
      console.log(`Bot reply (${m.botId}):`, JSON.stringify(m.blocks, null, 2));
    }
  } catch (err) {
    console.error("Error executing research task:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
