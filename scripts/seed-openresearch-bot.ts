import { importPreset } from "./lib/api.js";

async function main() {
  console.log("Importing the OpenResearch preset...");
  const bot = await importPreset("openresearch");
  console.log(`OpenResearch ready (id=${bot.id}). Assign it a model in the bot settings.`);
}

main().catch((error) => {
  console.error("Seeding error:", error);
  process.exit(1);
});
