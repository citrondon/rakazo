import fs from "node:fs";
import path from "node:path";
import { createDb, createRepos } from "../packages/db/src/index.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const { prisma, pool } = createDb(databaseUrl);
  const repos = createRepos(prisma);

  try {
    // 1. Locate primary user and space
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

    console.log(`Found actor: user=${actor.userId}, space=${actor.spaceId}`);

    // 2. Read preset from bot-library/openresearch.v1.json
    let manifestPath = "/app/bot-library/openresearch.v1.json";
    if (!fs.existsSync(manifestPath)) {
      manifestPath = path.resolve(process.cwd(), "bot-library/openresearch.v1.json");
    }
    if (!fs.existsSync(manifestPath)) {
      manifestPath = path.resolve(process.cwd(), "../../bot-library/openresearch.v1.json");
    }
    if (!fs.existsSync(manifestPath)) {
      console.error(`Preset not found at ${manifestPath}`);
      process.exit(1);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    // 3. Check if OpenResearch bot already exists
    const existing = await prisma.bot.findFirst({
      where: {
        spaceId: actor.spaceId,
        userId: actor.userId,
        name: manifest.bot.name,
        archivedAt: null,
      },
    });

    let botId: string;
    if (existing) {
      console.log(
        `Bot '${manifest.bot.name}' already exists (id=${existing.id}). Updating profile and model...`,
      );
      botId = existing.id;
      await prisma.bot.update({
        where: { id: botId },
        data: {
          title: manifest.bot.title,
          description: manifest.bot.description,
          instructions: manifest.bot.instructions,
          modelProvider: "openai-compatible",
          modelId: "claude-sonnet-5",
        },
      });
    } else {
      console.log(`Creating bot '${manifest.bot.name}'...`);
      const bot = await repos.createBot(actor, {
        name: manifest.bot.name,
        title: manifest.bot.title,
        description: manifest.bot.description,
        instructions: manifest.bot.instructions,
        notifyOnFinish: true,
        computerMode: "team",
        modelProvider: "openai-compatible",
        modelId: "claude-sonnet-5",
      });
      botId = bot.id;
      console.log(`Bot created successfully (id=${botId})`);
    }

    // 4. Upsert memory documents from manifest
    for (const mem of manifest.memory) {
      const existingDoc = await prisma.memoryDocument.findFirst({
        where: {
          botId,
          spaceId: actor.spaceId,
          path: mem.path,
        },
      });

      if (existingDoc) {
        await prisma.memoryDocument.update({
          where: { id: existingDoc.id },
          data: { content: mem.content },
        });
        console.log(`Updated memory document: ${mem.path}`);
      } else {
        await prisma.memoryDocument.create({
          data: {
            botId,
            spaceId: actor.spaceId,
            userId: actor.userId,
            scope: "bot",
            path: mem.path,
            content: mem.content,
          },
        });
        console.log(`Created memory document: ${mem.path}`);
      }
    }

    // 5. Upsert routines from manifest
    for (const routine of manifest.routines) {
      const existingRoutine = await prisma.routine.findFirst({
        where: {
          botId,
          spaceId: actor.spaceId,
          name: routine.name,
        },
      });

      if (!existingRoutine) {
        await prisma.routine.create({
          data: {
            botId,
            spaceId: actor.spaceId,
            userId: actor.userId,
            name: routine.name,
            prompt: routine.prompt,
            crons: routine.crons,
            timezone: routine.timezone,
            active: true,
          },
        });
        console.log(`Created routine: ${routine.name}`);
      } else {
        console.log(`Routine already exists: ${routine.name}`);
      }
    }

    console.log("Seeding OpenResearch bot completed successfully!");
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seeding error:", err);
  process.exit(1);
});
