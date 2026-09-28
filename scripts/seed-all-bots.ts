import fs from "node:fs";
import path from "node:path";
import { createDb, createRepos } from "../packages/db/src/index.js";

const RECOMMENDED_MODELS: Record<string, string> = {
  OpenResearch: "claude-sonnet-5",
  GrokCoder: "claude-sonnet-5",
  TrendScout: "deepseek-v4-flash",
  ExecutiveChief: "claude-sonnet-5",
  DataAnalyst: "claude-sonnet-5",
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const { prisma, pool } = createDb(databaseUrl);
  const repos = createRepos(prisma);

  try {
    const user = await prisma.user.findFirst();
    if (!user) {
      console.error("No user found in database.");
      process.exit(1);
    }

    const space =
      (await prisma.space.findFirst({
        where: { isDefault: true },
      })) || (await prisma.space.findFirst());

    if (!space) {
      console.error("No space found in database.");
      process.exit(1);
    }

    const actor = {
      userId: user.id,
      spaceId: space.id,
      email: user.email ?? "owner@rakazo.local",
      isDeploymentOwner: true,
    };

    console.log(`Seeding bots for user=${actor.userId}, space=${actor.spaceId}`);

    const presetFiles = [
      "openresearch.v1.json",
      "grok-coder.v1.json",
      "trend-scout.v1.json",
      "executive-chief.v1.json",
      "data-analyst.v1.json",
    ];

    for (const filename of presetFiles) {
      const candidates = [
        path.resolve("/app/bot-library", filename),
        path.resolve(process.cwd(), "bot-library", filename),
        path.resolve(process.cwd(), "../../bot-library", filename),
      ];
      const manifestPath = candidates.find((p) => fs.existsSync(p));
      if (!manifestPath) {
        console.error(`Preset not found: ${filename}`);
        continue;
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const botName = manifest.bot.name;
      const modelId = RECOMMENDED_MODELS[botName] || "claude-sonnet-5";

      const existing = await prisma.bot.findFirst({
        where: {
          spaceId: actor.spaceId,
          userId: actor.userId,
          name: botName,
          archivedAt: null,
        },
      });

      let botId: string;
      if (existing) {
        console.log(`Bot '${botName}' exists (id=${existing.id}). Updating profile & model...`);
        botId = existing.id;
        await prisma.bot.update({
          where: { id: botId },
          data: {
            title: manifest.bot.title,
            description: manifest.bot.description,
            instructions: manifest.bot.instructions,
            modelProvider: "openai-compatible",
            modelId,
          },
        });
      } else {
        console.log(`Creating bot '${botName}'...`);
        const created = await repos.createBot(actor, {
          name: botName,
          title: manifest.bot.title,
          description: manifest.bot.description,
          instructions: manifest.bot.instructions,
          notifyOnFinish: true,
          computerMode: "team",
          modelProvider: "openai-compatible",
          modelId,
        });
        botId = created.id;
        console.log(`Bot '${botName}' created (id=${botId})`);
      }

      // Memory documents
      for (const mem of manifest.memory ?? []) {
        const existingDoc = await prisma.memoryDocument.findFirst({
          where: { botId, spaceId: actor.spaceId, path: mem.path },
        });
        if (existingDoc) {
          await prisma.memoryDocument.update({
            where: { id: existingDoc.id },
            data: { content: mem.content },
          });
        } else {
          await prisma.memoryDocument.create({
            data: {
              spaceId: actor.spaceId,
              userId: actor.userId,
              botId,
              scope: "bot",
              path: mem.path,
              content: mem.content,
            },
          });
        }
      }

      // Routines
      for (const routine of manifest.routines ?? []) {
        const existingRoutine = await prisma.routine.findFirst({
          where: { botId, spaceId: actor.spaceId, name: routine.name },
        });
        if (!existingRoutine) {
          await prisma.routine.create({
            data: {
              spaceId: actor.spaceId,
              userId: actor.userId,
              botId,
              name: routine.name,
              prompt: routine.prompt,
              crons: routine.crons,
              timezone: routine.timezone,
              active: true,
              notify: true,
            },
          });
        }
      }
    }

    console.log("All 5 bots seeded and synced successfully!");
  } catch (error) {
    console.error("Seeding error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
