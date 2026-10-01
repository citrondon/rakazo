import { createGroup, findBotByName, listGroups } from "./lib/api.js";

const GROUP_NAME = "GrokBot Team War Room";
const MEMBER_NAMES = ["ExecutiveChief", "GrokCoder", "TrendScout", "DataAnalyst"];

async function main() {
  console.log(`Seeding "${GROUP_NAME}" group...`);

  const botIds: string[] = [];
  for (const name of MEMBER_NAMES) {
    const bot = await findBotByName(name);
    botIds.push(bot.id);
    console.log(`- ${bot.name} (${bot.id})`);
  }

  const existing = (await listGroups()).find((group) => group.name === GROUP_NAME);
  if (existing) {
    console.log(`Group "${existing.name}" (id=${existing.id}) already exists; members unchanged.`);
    return;
  }

  const group = await createGroup({ name: GROUP_NAME, botIds });
  console.log(`Group "${group.name}" (id=${group.id}) ready with ${botIds.length} members.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
