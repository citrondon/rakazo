import { findBotByName, sendToThread, waitForRun } from "./lib/api.js";

const PROMPT =
  "Recherchiere bitte die neuesten Trends zu Open-Source MCP-Servern unter https://github.com/punkpeye/awesome-mcp-servers und fasse die 5 wichtigsten Kategorien zusammen. Speichere das Ergebnis als 'research/mcp-trends.md' im gemeinsamen Workspace.";

async function main() {
  const bot = await findBotByName(process.env.RAKAZO_RESEARCH_BOT_NAME ?? "OpenResearch");
  const { runId } = await sendToThread({ botId: bot.id, text: PROMPT });
  console.log(`Research run ${runId} triggered! Waiting...`);

  const run = await waitForRun(runId);
  console.log(`Run status: ${run.status}`);
  process.exitCode = run.status === "completed" ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
