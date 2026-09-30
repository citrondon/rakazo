import { createDb } from "../packages/db/src/index.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const { prisma, pool } = createDb(databaseUrl);

  try {
    const spaceId = "e272d745988bd720ba0c9699ffc5de54";
    const userId = "A1asxvFeYqmkNHzspbHUFz7MVXygtq8a";
    const groupId = "grp_research_intelligence";
    const threadId = "th_grp_research_intelligence";

    const openResearchBotId = "cmujqnpd00000g0pcq38bumth";
    const grokCoderBotId = "cmujsli6p0000swpcuxih7j5f";
    const chiefBotId = "cmuiuj3po00033ppc28z3fawk";

    // Helper to run a bot turn and wait for it
    async function executeBotTurn(botId: string, botName: string, promptText: string) {
      console.log(`\n======================================================`);
      console.log(`Starting turn for ${botName} (${botId})...`);
      console.log(`Prompt: "${promptText}"`);
      console.log(`======================================================`);

      const thread = await prisma.thread.findUniqueOrThrow({ where: { id: threadId } });
      const seq = thread.nextMessageSeq;

      await prisma.thread.update({
        where: { id: threadId },
        data: {
          nextMessageSeq: seq + 1,
          nextEventSeq: thread.nextEventSeq + 1,
        },
      });

      const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const msgId = `msg_${stamp}`;
      const taskId = `task_${stamp}`;
      const runId = `run_${stamp}`;

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
      await pool.query(
        `SELECT graphile_worker.add_job('run.continue', json_build_object('runId', $1::text));`,
        [run.id],
      );

      console.log(`Job enqueued. Polling status for run ${run.id}...`);

      let lastStatus = "queued";
      const start = Date.now();
      while (Date.now() - start < 180000) {
        await new Promise((r) => setTimeout(r, 4000));
        const currentRun = await prisma.run.findUnique({
          where: { id: run.id },
        });

        if (currentRun && currentRun.status !== lastStatus) {
          lastStatus = currentRun.status;
          console.log(`Run status changed to: ${lastStatus}`);
        }

        if (currentRun && (currentRun.status === "completed" || currentRun.status === "failed")) {
          console.log(`Run finished with status: ${currentRun.status}`);
          if (currentRun.status === "failed") {
            console.error(`Run error:`, currentRun.error);
          } else {
            // Fetch assistant response messages
            const reply = await prisma.message.findFirst({
              where: { runId: run.id, role: "assistant" },
              orderBy: { seq: "desc" },
            });
            if (reply) {
              const textBlock = reply.blocks.find((b: any) => b.kind === "text");
              console.log(
                `\nResponse from ${botName}:\n`,
                textBlock ? (textBlock as any).text : "[Non-text response]",
              );
            }
          }
          return currentRun.status === "completed";
        }
      }

      console.error(`Timeout waiting for run ${run.id}`);
      return false;
    }

    // Step 1: OpenResearch writes trending tool spec
    const step1Prompt =
      "@OpenResearch recherchiere bitte Best Practices für ein schlankes Python CLI-Tool zur Tech- und Trend-Überwachung (HackerNews Top Stories und Dev-Trends). Erstelle eine präzise Spezifikation (Zweck, Argumente, JSON-Fallback, strukturierte Terminal-Ausgabe) und speichere sie als 'research/trending-agent-spec.md' im gemeinsamen Workspace.";

    const s1Ok = await executeBotTurn(openResearchBotId, "OpenResearch", step1Prompt);
    if (!s1Ok) {
      console.error("Step 1 failed.");
      process.exit(1);
    }

    // Step 2: GrokCoder implements and verifies the tool
    const step2Prompt =
      "@GrokCoder lies die Spezifikation in 'research/trending-agent-spec.md' über Workspace-Files. Implementiere das vollständige Python-Skript in 'tools/trending_monitor.py' (nutze nur die Python Standardbibliothek: urllib, json, argparse, sys, time). Führe danach im Terminal via 'run_process' (Workspace-Exec) den Befehl 'python3 /home/rakazo/shared/tools/trending_monitor.py --help' und 'python3 /home/rakazo/shared/tools/trending_monitor.py --top 3' aus. Verifiziere den Exit-Code 0 und zeige den Output.";

    const s2Ok = await executeBotTurn(grokCoderBotId, "GrokCoder", step2Prompt);
    if (!s2Ok) {
      console.error("Step 2 failed.");
      process.exit(1);
    }

    // Step 3: Chief reviews and confirms
    const step3Prompt =
      "@Chief prüfe bitte die von OpenResearch erstellte Spezifikation 'research/trending-agent-spec.md' und die von GrokCoder implementierte und getestete Datei 'tools/trending_monitor.py'. Bestätige die Fertigstellung kurz und prägnant.";

    const s3Ok = await executeBotTurn(chiefBotId, "Chief", step3Prompt);
    if (!s3Ok) {
      console.error("Step 3 failed.");
      process.exit(1);
    }

    console.log("\nPipeline successfully completed!");
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
