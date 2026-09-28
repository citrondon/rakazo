import fs from "node:fs";
import path from "node:path";
import { createDb } from "../packages/db/src/index.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const { prisma, pool } = createDb(databaseUrl);

  try {
    const m = await prisma.message.findFirst({
      where: { threadId: "th_grp_research_intelligence", role: "bot" },
      orderBy: { createdAt: "desc" },
    });
    if (!m || !m.blocks) {
      console.error("No bot message found");
      return;
    }
    const blocks = m.blocks as Array<{ kind: string; text?: string }>;
    const textBlock = blocks.find((b) => b.kind === "text" && b.text);
    if (!textBlock || !textBlock.text) {
      console.error("No text block found in message");
      return;
    }

    const targetDir = "/data/homes/team-e272d745988bd720ba0c9699ffc5de54/shared/research";
    fs.mkdirSync(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, "mcp-trends.md");
    fs.writeFileSync(targetFile, textBlock.text, "utf8");
    console.log(`Successfully wrote ${targetFile} (${textBlock.text.length} bytes)`);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
