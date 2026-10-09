import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { applyLegacyEnvAliases } from "../env-alias.js";

export function loadRootEnv(options: { allowInTests?: boolean } = {}) {
  try {
    // Test runners and verification CLIs supply their own isolated environment.
    // Loading a developer's credentials here also changes otherwise offline tests.
    if (process.env.NODE_ENV === "test" && !options.allowInTests) return;
    let dir = process.cwd();
    for (let i = 0; i < 8; i += 1) {
      const candidate = path.join(dir, ".env");
      if (existsSync(candidate)) {
        config({ path: candidate, override: false });
        if (process.env.DATA_DIR && !path.isAbsolute(process.env.DATA_DIR)) {
          process.env.DATA_DIR = path.resolve(dir, process.env.DATA_DIR);
        }
        return;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    config();
  } finally {
    // Runs before anything reads a setting, and also in tests, so a suite that
    // sets the earlier name still exercises the same code path as a deployment.
    applyLegacyEnvAliases();
  }
}
