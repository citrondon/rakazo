import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotRoleRegistry } from "@rakazo/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamBootstrapper } from "./bootstrap.js";

describe("TeamBootstrapper", () => {
  let tempDir: string;
  let repoDir: string;
  let roleRegistry: BotRoleRegistry;
  let bootstrapper: TeamBootstrapper;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "team-sync-test-"));
    repoDir = join(tempDir, "template-repo");
    mkdirSync(repoDir, { recursive: true });

    roleRegistry = new BotRoleRegistry();
    bootstrapper = new TeamBootstrapper(roleRegistry);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("clones repo, loads template, and registers roles", async () => {
    // Create a mock template repo structure
    const templateContent = `
version: "1.0"
roles:
  - id: "test-architect"
    displayName: "Test Architect"
    description: "Designs test architecture"
    capabilities:
      - name: "terminal"
        level: "write"
        constraints: []
      - name: "git"
        level: "write"
        constraints: ["no-force-push"]
    modelProfile:
      family: "Anthropic"
      model: "claude-opus-4"
      temperature: 0.2
      maxTokens: 8192
      costTier: "high"
    trustTier: "high"
    metadata:
      domain: "testing"
skills:
  - name: "test-skill"
    version: "1.0.0"
    source: "local"
routines:
  - name: "test-routine"
    prompt: "Run tests"
    crons: []
    timezone: "UTC"
    active: false
    notify: true
    webhookEnabled: false
    githubEnabled: false
    template: true
mcpServers: []
policies:
  approval: {}
  security: {}
computerDefaults:
  kind: "docker"
  cpu: 2
  memory: 4096
`;
    writeFileSync(join(repoDir, "template.yaml"), templateContent);

    // Mock git clone by just using the local repo dir
    // The bootstrap method should handle this
    await bootstrapper.bootstrap(repoDir, "test-team", join(tempDir, "target"));

    // Verify role was registered
    const role = roleRegistry.get("test-architect");
    expect(role).toBeDefined();
    expect(role?.id).toBe("test-architect");
    expect(role?.displayName).toBe("Test Architect");
    expect(role?.capabilities).toHaveLength(2);
  });

  it("writes team-lock.json with pinned versions", async () => {
    const templateContent = `
version: "1.0"
roles: []
skills:
  - name: "skill-a"
    version: "1.2.3"
    source: "npm"
  - name: "skill-b"
    version: "2.0.0"
    source: "github"
routines: []
mcpServers: []
policies:
  approval: {}
  security: {}
computerDefaults:
  kind: "docker"
  cpu: 1
  memory: 2048
`;
    writeFileSync(join(repoDir, "template.yaml"), templateContent);

    const targetDir = join(tempDir, "target");
    await bootstrapper.bootstrap(repoDir, "test-team", targetDir);

    // Check team-lock.json was created
    const lockPath = join(targetDir, ".rakazo", "team-lock.json");
    const lockContent = require("node:fs").readFileSync(lockPath, "utf-8");
    const lock = JSON.parse(lockContent);
    expect(lock.version).toBe("1.0");
    expect(lock.skills).toHaveLength(2);
    expect(lock.skills[0].name).toBe("skill-a");
    expect(lock.skills[0].version).toBe("1.2.3");
  });

  it("rejects invalid template (missing required fields)", async () => {
    const invalidTemplate = `
version: "1.0"
roles: []
# missing skills, routines, mcpServers, policies, computerDefaults
`;
    writeFileSync(join(repoDir, "template.yaml"), invalidTemplate);

    await expect(
      bootstrapper.bootstrap(repoDir, "test-team", join(tempDir, "target")),
    ).rejects.toThrow();
  });
});
