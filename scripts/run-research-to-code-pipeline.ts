import { findBotByName, latestReply, sendToThread, waitForRun } from "./lib/api.js";

async function runBotTurn(botName: string, prompt: string, timeoutMs = 180_000) {
  const bot = await findBotByName(botName);
  console.log(`\n======================================================`);
  console.log(`Starting turn for ${bot.name} (${bot.id})...`);
  console.log(`Prompt: "${prompt}"`);
  console.log(`======================================================`);

  const { runId } = await sendToThread({ botId: bot.id, text: prompt });
  console.log(`Enqueued run ${runId}. Waiting...`);
  const run = await waitForRun(runId, { timeoutMs });
  console.log(`Run finished with status: ${run.status}`);

  if (run.status === "completed") {
    console.log(`\nResponse from ${bot.name}:\n`, (await latestReply({ botId: bot.id })) ?? "");
    return true;
  }
  console.error(`Run ${runId} ended with status "${run.status}".`);
  return false;
}

async function main() {
  const step1 =
    "Recherchiere bitte Best Practices für ein schlankes Python-CLI-Tool zur Tech- und Trend-Überwachung (HackerNews Top Stories und Dev-Trends). Erstelle eine präzise Spezifikation (Zweck, Argumente, JSON-Fallback, strukturierte Terminal-Ausgabe) und speichere sie als 'research/trending-agent-spec.md' im gemeinsamen Workspace.";
  if (!(await runBotTurn("OpenResearch", step1))) {
    console.error("Step 1 failed.");
    process.exit(1);
  }

  const step2 =
    "Lies die Spezifikation in 'research/trending-agent-spec.md' über Workspace-Files. Implementiere das vollständige Python-Skript in 'tools/trending_monitor.py' (nur Python-Standardbibliothek). Führe danach im Terminal 'python3 /home/rakazo/shared/tools/trending_monitor.py --help' und '... --top 3' aus und verifiziere den Exit-Code 0.";
  if (!(await runBotTurn("GrokCoder", step2))) {
    console.error("Step 2 failed.");
    process.exit(1);
  }

  const step3 =
    "Prüfe bitte die von OpenResearch erstellte Spezifikation 'research/trending-agent-spec.md' und die von GrokCoder implementierte und getestete Datei 'tools/trending_monitor.py'. Bestätige die Fertigstellung kurz und prägnant.";
  if (!(await runBotTurn("ExecutiveChief", step3, 120_000))) {
    console.error("Step 3 failed.");
    process.exit(1);
  }

  console.log("\nPipeline successfully completed!");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
