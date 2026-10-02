import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as yaml from "yaml";
import { SecretPattern } from "./guard.js";

const CONFIG_PATH = join(homedir(), ".rakazo", "credential-guard.yaml");

export interface CredentialGuardConfig {
  patterns?: SecretPattern[];
  hooks?: {
    preToolUse?: boolean;
    postToolUse?: boolean;
    transcriptWrite?: boolean;
  };
}

const DEFAULT_CONFIG: CredentialGuardConfig = {
  patterns: [],
  hooks: {
    preToolUse: true,
    postToolUse: true,
    transcriptWrite: true,
  },
};

export async function loadCredentialGuardConfig(): Promise<CredentialGuardConfig> {
  try {
    const content = await fs.readFile(CONFIG_PATH, "utf-8");
    const parsed = yaml.parse(content);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}