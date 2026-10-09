import {
  mkdirSync,
  mkdirSync as mkdirSyncSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  writeFileSync as writeFileSyncSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotRoleRegistry, DelegationRequestSchema } from "@bobbot/contracts";
import { CredentialGuard } from "@bobbot/credential-guard";
import { DelegationQueue } from "@bobbot/delegation-queue";
import { createJevMergeGate, JevMergeGate } from "@bobbot/jev-gate";
import { TeamBootstrapper } from "@bobbot/team-sync";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * E2E: Multi-Bot Orchestration Flow
 *
 * Test scenario: "e-commerce-store" team wants Checkout-Flow built
 * 1. Team bootstrap populates role registry
 * 2. Coordinator creates DelegationRequest with acceptance criteria
 * 3. Queue enqueues, assigns to implementer bot
 * 4. CredentialGuard sanitizes tool args during execution
 * 5. PR opened → JevMergeGate evaluates → merge allowed when all gates pass
 */
describe("Multi-Bot Orchestration E2E", () => {
  let tempDir: string;
  let templateDir: string;
  let targetDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "multi-bot-e2e-"));
    templateDir = join(tempDir, "template-repo");
    targetDir = join(tempDir, "target-project");
    mkdirSyncSync(templateDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("full orchestration flow: bootstrap → delegate → gate → guard", async () => {
    // --- Step 1: Team bootstrap ---
    const templateContent = `
version: "1.0"
roles:
  - id: "checkout-architect"
    displayName: "Checkout Architect"
    description: "Designs checkout flow architecture"
    capabilities:
      - name: "terminal"
        level: "write"
        constraints: []
    modelProfile:
      family: "Anthropic"
      model: "claude-opus-4"
      temperature: 0.2
      maxTokens: 8192
      costTier: "high"
    trustTier: "high"
    metadata: { domain: "checkout" }
  - id: "checkout-implementer"
    displayName: "Checkout Implementer"
    description: "Implements checkout flow code"
    capabilities:
      - name: "terminal"
        level: "write"
      - name: "git"
        level: "write"
        constraints: ["no-force-push"]
    modelProfile:
      family: "Anthropic"
      model: "claude-sonnet-4"
      temperature: 0.3
      maxTokens: 16384
      costTier: "medium"
    trustTier: "medium"
    metadata: { domain: "checkout" }
skills:
  - name: "playwright-testing"
    version: "1.5.0"
    source: "npm"
routines: []
mcpServers: []
policies:
  approval: {}
  security: {}
computerDefaults:
  kind: "docker"
  cpu: 2
  memory: 4096
`;
    writeFileSyncSync(join(templateDir, "template.yaml"), templateContent);

    const roleRegistry = new BotRoleRegistry();
    const bootstrapper = new TeamBootstrapper(roleRegistry);
    await bootstrapper.bootstrap(templateDir, "e-commerce-store", targetDir);

    // Verify roles were registered
    expect(roleRegistry.get("checkout-architect")).toBeDefined();
    expect(roleRegistry.get("checkout-implementer")).toBeDefined();
    expect(roleRegistry.listByCapability("terminal")).toHaveLength(2);

    // --- Step 2: Coordinator creates DelegationRequest ---
    const delegationRequest = DelegationRequestSchema.parse({
      missionId: "m01-checkout-flow",
      sliceId: "03-checkout-form",
      roleId: "checkout-implementer",
      acceptanceCriteria: ["tests pass", "typecheck clean", "WCAG 2.1 AA"],
      timeoutMs: 1800000,
      artifacts: ["src/checkout.tsx", "tests/checkout.test.tsx"],
      dependencies: [],
    });

    // --- Step 3: Queue enqueues and assigns ---
    const queue = new DelegationQueue();
    const entry = await queue.enqueue(delegationRequest);
    expect(entry.status).toBe("pending");

    const assigned = await queue.assign(
      entry.id,
      "impl-bot-1",
      join(targetDir, "worktrees", "checkout-impl"),
    );
    expect(assigned.status).toBe("assigned");
    expect(assigned.assignedBotId).toBe("impl-bot-1");

    const started = await queue.start(entry.id);
    expect(started.status).toBe("running");

    // --- Step 4: Credential Guard active during execution ---
    const credentialGuard = new CredentialGuard();
    const maliciousInput = 'shell("cat .env: MYAPP_DB_PASSWORD=supersecret123")';
    const { clean, blocked } = credentialGuard.sanitizeInput(maliciousInput);
    expect(blocked).toBe(true);
    expect(clean).toContain("[REDACTED:MYAPP_DB_PASSWORD]");

    // Simulate successful completion (guard didn't block in this case because we're testing redaction)
    const result = await queue.complete(entry.id, {
      success: true,
      artifacts: delegationRequest.acceptanceCriteria ? delegationRequest.artifacts || [] : [],
      logs: ["implemented checkout form", "tests passing", "typecheck clean"],
    });
    expect(result.status).toBe("done");
    expect(result.result?.success).toBe(true);

    // --- Step 5: JevMergeGate evaluates ---
    const gate = createJevMergeGate(); // No API key = jev-decision skipped
    const gateInput = {
      prNumber: 42,
      headSha: "abc123def456",
      baseSha: "main-branch-sha",
      requiredGates: [
        { name: "ci" as const, required: true },
        { name: "two-family-review" as const, required: true },
        { name: "qa-verdict" as const, required: true },
      ],
    };

    const gateResult = await gate.evaluate(gateInput);
    expect(gateResult.allowed).toBe(true); // CI, review, QA all pass (placeholders return true)
    expect(gateResult.results.length).toBe(3);
    expect(gateResult.results.every((r) => r.status === "pass")).toBe(true);

    // Verify the complete flow state
    const finalEntry = queue.get(entry.id);
    expect(finalEntry?.status).toBe("done");
    expect(finalEntry?.result?.artifacts).toContain("src/checkout.tsx");
    expect(finalEntry?.result?.logs).toContain("tests passing");
  });

  it("orchestration blocks when credential guard finds secrets in tool args", async () => {
    const credentialGuard = new CredentialGuard();
    const dangerousInput = 'shell("export PASSWORD=hunter2 && run-script.sh")';
    const { clean, blocked } = credentialGuard.sanitizeInput(dangerousInput);

    expect(blocked).toBe(true);
    expect(clean).toContain("[REDACTED:PASSWORD]");
    expect(clean).not.toContain("hunter2");
  });

  it("orchestration blocks merge when required gate fails", async () => {
    const gate = createJevMergeGate();

    // Override CI to fail
    (gate as any).checkCI = (() => Promise.resolve(false)) as any;

    const gateResult = await gate.evaluate({
      prNumber: 99,
      headSha: "failed-sha",
      baseSha: "main",
      requiredGates: [
        { name: "ci", required: true },
        { name: "qa-verdict", required: true },
      ],
    });

    expect(gateResult.allowed).toBe(false);
    const ciResult = gateResult.results.find((r) => r.name === "ci");
    expect(ciResult?.status).toBe("fail");
  });
});
