import { findBotByName, latestReply, sendToThread, waitForRun } from "./lib/api.js";

const DEFAULT_PROMPT =
  "Analysiere meinen E-Mail-Posteingang und hilf mir beim Aufräumen: Prüfe alle aktuellen E-Mails, kategorisiere sie nach Wichtigkeit (Dringend/Wichtig, Info, Newsletter, Spam) und erstelle einen konkreten Aufräum- und Aktionsplan mit Checkboxen und Empfehlungen.";

async function main() {
  const botName = process.argv[2] || "ExecutiveChief";
  const prompt = process.argv[3] || DEFAULT_PROMPT;

  const bot = await findBotByName(botName);
  console.log(`Sending prompt to bot "${bot.name}" (ID: ${bot.id})...`);
  console.log(`Prompt: "${prompt}"`);

  const { runId } = await sendToThread({ botId: bot.id, text: prompt });
  console.log(`Enqueued chat run ${runId}. Waiting for completion...`);

  const run = await waitForRun(runId);
  if (run.status !== "completed") {
    console.error(`Run ${runId} ended with status "${run.status}".`);
    process.exitCode = 1;
    return;
  }
  const reply = await latestReply({ botId: bot.id });
  console.log("\n=======================================================");
  console.log(`${bot.name} Antwort:\n`);
  console.log(reply ?? "[Non-text response]");
  console.log("=======================================================");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
