import { importPreset } from "./lib/api.js";

const PRESET_SLUGS = [
  "openresearch",
  "grok-coder",
  "trend-scout",
  "executive-chief",
  "data-analyst",
];

async function main() {
  for (const slug of PRESET_SLUGS) {
    console.log(`Importing preset "${slug}"...`);
    const bot = await importPreset(slug);
    console.log(`- ${bot.name} ready (id=${bot.id}).`);
  }
  console.log(`Imported ${PRESET_SLUGS.length} bots. Assign each one a model in the bot settings.`);
}

main().catch((error) => {
  console.error("Seeding error:", error);
  process.exit(1);
});
