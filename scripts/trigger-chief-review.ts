import { findBotByName, latestReply, sendToThread, waitForRun } from "./lib/api.js";

const PROMPT =
  "Prüfe bitte die von OpenResearch erstellte Spezifikation 'research/trending-agent-spec.md' und das von GrokCoder implementierte Tool 'tools/trending_monitor.py'. Gib eine kurze, prägnante Zusammenfassung und Bestätigung des Meilensteins im Chat ab.";

async function main() {
  const bot = await findBotByName(process.env.RAKAZO_CHIEF_BOT_NAME ?? "ExecutiveChief");
  const { runId } = await sendToThread({ botId: bot.id, text: PROMPT });
  console.log(`Chief review run ${runId} enqueued. Waiting...`);

  const run = await waitForRun(runId, { timeoutMs: 120_000 });
  if (run.status !== "completed") {
    console.error(`Run ${runId} ended with status "${run.status}".`);
    process.exitCode = 1;
    return;
  }
  console.log("\nChief Review:\n", (await latestReply({ botId: bot.id })) ?? "");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
