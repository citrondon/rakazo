import fs from "node:fs";
import path from "node:path";
import { findGroupByName, latestReply } from "./lib/api.js";

/**
 * Writes the research group's latest bot reply into the shared workspace as `mcp-trends.md`.
 * The reply is read through the API; only the file lands on disk.
 */
async function main() {
  const spaceId = process.env.RAKAZO_SPACE_ID;
  if (!spaceId) {
    console.error("RAKAZO_SPACE_ID is required to locate the shared workspace folder.");
    process.exit(1);
  }

  const group = await findGroupByName(process.env.RAKAZO_RESEARCH_GROUP ?? "Research Intelligence");
  const text = await latestReply({ groupId: group.id });
  if (!text) {
    console.error(`No text reply found in "${group.name}".`);
    return;
  }

  const targetDir = `/data/homes/team-${spaceId}/shared/research`;
  fs.mkdirSync(targetDir, { recursive: true });
  const targetFile = path.join(targetDir, "mcp-trends.md");
  fs.writeFileSync(targetFile, text, "utf8");
  console.log(`Successfully wrote ${targetFile} (${text.length} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
