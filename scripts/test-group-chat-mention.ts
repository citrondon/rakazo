import {
  findBotByName,
  findGroupByName,
  latestReply,
  sendToThread,
  waitForRun,
} from "./lib/api.js";

const GROUP_NAME = "GrokBot Team War Room";

async function main() {
  const prompt =
    process.argv[2] ||
    "@TrendScout Fasse kurz die Top 3 Tech-Trends von heute zusammen und gib eine Empfehlung für das Team.";

  const group = await findGroupByName(GROUP_NAME);
  console.log(`Connecting to "${group.name}"...`);

  // Mention whichever member the prompt names; default to ExecutiveChief.
  const bots = await Promise.all(
    ["ExecutiveChief", "GrokCoder", "TrendScout", "DataAnalyst"].map((name) =>
      findBotByName(name).catch(() => null),
    ),
  );
  const target =
    bots.find((bot) => bot && prompt.toLowerCase().includes(`@${bot.name.toLowerCase()}`)) ??
    bots.find((bot) => bot?.name === "ExecutiveChief");
  if (!target) throw new Error("Could not determine a responding bot for the group message.");

  console.log(`Target bot: ${target.name} (${target.id})`);
  const { runId } = await sendToThread({ groupId: group.id, text: prompt, mentions: [target.id] });
  console.log(`Enqueued run ${runId} for ${target.name}. Waiting...`);

  const run = await waitForRun(runId);
  if (run.status === "completed") {
    console.log(`\n[War Room] ${target.name} Antwort:\n`);
    console.log((await latestReply({ groupId: group.id })) ?? "[Non-text response]");
  } else {
    console.error(`Run ${runId} ended with status "${run.status}".`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
