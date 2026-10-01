import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(here, "../../.env");
if (existsSync(rootEnv)) config({ path: rootEnv });
config();

const datasource: { url: string; shadowDatabaseUrl?: string } = {
  url: process.env.DATABASE_URL ?? "postgres://rakazo:rakazo@127.0.0.1:5433/rakazo",
};

// Required by `prisma migrate diff --from-migrations` (migration/schema parity
// checks). The shadow database only needs to exist; Prisma resets its schema.
if (process.env.SHADOW_DATABASE_URL) {
  datasource.shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource,
});
