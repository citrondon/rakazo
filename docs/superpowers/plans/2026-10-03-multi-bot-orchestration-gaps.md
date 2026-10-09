# Multi-Bot Orchestration Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 5 orchestration gaps between BobBot's generic "Bot" model and Agent-Stack's team patterns: (1) Role-based Bot taxonomy with capabilities, (2) Structured delegation queue with acceptance criteria, (3) Jev-powered local merge gates, (4) Git-synced team templates, (5) Credential Guard runtime hooks.

**Architecture:** Extend `packages/contracts` with role/capability/delegation types; add new packages `bot-roles`, `delegation-queue`, `jev-gate`, `team-sync`, `credential-guard`; wire into existing executor/bot-runtime via hooks. All changes are additive — existing Bot schema stays compatible.

**Tech Stack:** TypeScript, Zod schemas, Vitest, Turbo monorepo, existing BobBot patterns (contracts → adapters → executor).

**Spec:** `rakazo-multi-bot-orchestration-gaps.md` (user analysis + AI feedback), this plan implements the 5 corrected designs from AI feedback.

---

## Global Constraints

- Node >= 22.22.2 || >=24.0.0 || >=26.0.0 (from package.json)
- All new types in `packages/contracts/src/` with Zod schemas, exported from `index.ts`
- Tests co-located as `*.test.ts` next to source
- `pnpm test` must pass; `pnpm check` (tsc + biome) must pass
- No breaking changes to existing `BotSchema` — extend via optional fields or new schemas
- Follow existing patterns: `domain.ts` for core types, `ids.ts` for Id, `events.ts` for run/events
- Credential Guard must hook into `executor.ts` tool dispatch (PreToolUse/PostToolUse equivalent)
- Jev gate reuses existing `jev-auto-review.ts` logic, exposes local function (no CI required)

---

## Review Focus

| Input / Condition | Expected Behavior | Test Location |
|-------------------|-------------------|---------------|
| Bot with `role: "architect"` but missing `capabilities: ["terminal"]` | Validation error at bot creation/update | `bot-roles.test.ts` |
| DelegationRequest without `acceptanceCriteria` | Rejected (mandatory field) | `delegation-queue.test.ts` |
| PR merge when Jev gate returns `fail` on `two-family-review` | Merge blocked, reason surfaced | `jev-gate.test.ts` |
| `team bootstrap` with template repo containing malicious `env` in MCP config | Secrets redacted, deploy blocked | `credential-guard.test.ts` |
| Transcript contains `MYAPP_DB_PASSWORD=secret123` | Stored as `[REDACTED:MYAPP_DB_PASSWORD]` | `credential-guard.test.ts` |
| Windows `O_NOFOLLOW` undefined in `no-follow.ts` | Symlink protection stays ON (not silently off) | `no-follow.test.ts` (existing) |

---

## Task 1: Bot Role & Capability Types (Contracts)

**Files:**
- Create: `packages/contracts/src/bot-role.ts`
- Create: `packages/contracts/src/bot-role.test.ts`
- Modify: `packages/contracts/src/index.ts` (export new types)
- Modify: `packages/contracts/src/domain.ts` (extend `BotSchema` with optional `roleId`, `capabilities`, `modelProfile`, `trustTier`)

**Interfaces:**
- Consumes: `Id` from `ids.ts`, `BotSchema` from `domain.ts`
- Produces: `BotRole`, `Capability`, `ModelProfile`, `BotRoleRegistry`, extended `Bot` with optional role fields

- [ ] **Step 1.1: Write failing test for BotRole schema validation**

```typescript
// packages/contracts/src/bot-role.test.ts
import { BotRoleSchema, CapabilitySchema, ModelProfileSchema } from "./bot-role.js";

describe("BotRole", () => {
  it("validates a complete role with capabilities and model profile", () => {
    const role = BotRoleSchema.parse({
      id: "checkout-architect",
      displayName: "Checkout Architect",
      description: "Designs payment flow architecture",
      capabilities: [
        { name: "terminal", level: "write", constraints: [] },
        { name: "browser", level: "read", constraints: [] },
        { name: "git", level: "write", constraints: ["no-force-push"] },
      ],
      modelProfile: {
        family: "Anthropic",
        model: "claude-opus-4",
        temperature: 0.2,
        maxTokens: 8192,
        costTier: "high",
      },
      trustTier: "high",
      metadata: { domain: "payments" },
    });
    expect(role.id).toBe("checkout-architect");
    expect(role.capabilities).toHaveLength(3);
  });

  it("rejects unknown capability level", () => {
    expect(() => BotRoleSchema.parse({
      id: "test", displayName: "T", description: "D",
      capabilities: [{ name: "terminal", level: "invalid", constraints: [] }],
      modelProfile: { family: "Anthropic", model: "claude", temperature: 0, maxTokens: 100, costTier: "low" },
      trustTier: "low",
    })).toThrow();
  });

  it("registry lists roles by capability", () => {
    const { BotRoleRegistry } = await import("./bot-role.js");
    const reg = new BotRoleRegistry();
    reg.register({ id: "r1", displayName: "R1", description: "D", capabilities: [{ name: "terminal", level: "write", constraints: [] }], modelProfile: { family: "Anthropic", model: "c", temperature: 0, maxTokens: 100, costTier: "low" }, trustTier: "low" });
    reg.register({ id: "r2", displayName: "R2", description: "D", capabilities: [{ name: "browser", level: "read", constraints: [] }], modelProfile: { family: "Anthropic", model: "c", temperature: 0, maxTokens: 100, costTier: "low" }, trustTier: "low" });
    expect(reg.listByCapability("terminal")).toHaveLength(1);
    expect(reg.listByCapability("browser")).toHaveLength(1);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `cd packages/contracts && pnpm vitest run bot-role.test.ts`
Expected: FAIL — `bot-role.ts` does not exist

- [ ] **Step 1.3: Implement `bot-role.ts`**

Create `packages/contracts/src/bot-role.ts` with:
- `CapabilitySchema` (name, level: 'read'|'write'|'admin', constraints?: string[])
- `ModelProfileSchema` (family: enum, model: string, temperature: number, maxTokens: number, costTier: 'low'|'medium'|'high')
- `BotRoleSchema` (id, displayName, description, capabilities: Capability[], modelProfile, trustTier, metadata?: Record<string,unknown>)
- `BotRoleRegistry` class with `register()`, `get()`, `listByCapability()`
- Export all types and schemas

- [ ] **Step 1.4: Extend `BotSchema` in `domain.ts` with optional role fields**

Add to `BotSchema` (optional, nullable):
- `roleId: Id.nullable().optional()`
- `capabilities: z.array(CapabilitySchema).optional()`
- `modelProfile: ModelProfileSchema.nullable().optional()`
- `trustTier: z.enum(['low','medium','high']).nullable().optional()`

Keep backward compatible — all optional.

- [ ] **Step 1.5: Export from `index.ts`**

Add `export * from "./bot-role.js";`

- [ ] **Step 1.6: Run tests**

Run: `pnpm vitest run packages/contracts/src/bot-role.test.ts`
Expected: PASS

- [ ] **Step 1.7: Run full contracts test suite**

Run: `pnpm test --filter=@rakazo/contracts`
Expected: PASS

- [ ] **Step 1.8: Commit**

```bash
git add packages/contracts/src/bot-role.ts packages/contracts/src/bot-role.test.ts packages/contracts/src/domain.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add bot role, capability, model profile types and registry"
```

---

## Task 2: Delegation Queue with Acceptance Criteria

**Files:**
- Create: `packages/contracts/src/delegation.ts`
- Create: `packages/contracts/src/delegation.test.ts`
- Create: `packages/delegation-queue/src/queue.ts`
- Create: `packages/delegation-queue/src/queue.test.ts`
- Create: `packages/delegation-queue/package.json`
- Modify: `package.json` (add workspace package)
- Modify: `packages/contracts/src/index.ts` (export delegation types)

**Interfaces:**
- Consumes: `BotRole`, `Id` from contracts
- Produces: `DelegationRequest`, `QueueEntry`, `DelegationResult`, `Queue` class

- [ ] **Step 2.1: Write failing test for DelegationRequest schema**

```typescript
// packages/contracts/src/delegation.test.ts
import { DelegationRequestSchema, QueueEntrySchema } from "./delegation.js";

describe("DelegationRequest", () => {
  it("requires missionId, sliceId, roleId, acceptanceCriteria", () => {
    const req = DelegationRequestSchema.parse({
      missionId: "m01-checkout",
      sliceId: "03-checkout-form",
      roleId: "checkout-implementer",
      acceptanceCriteria: ["tests pass", "typecheck clean", "WCAG 2.1 AA"],
    });
    expect(req.missionId).toBe("m01-checkout");
    expect(req.acceptanceCriteria).toHaveLength(3);
  });

  it("rejects missing acceptanceCriteria", () => {
    expect(() => DelegationRequestSchema.parse({
      missionId: "m01", sliceId: "s1", roleId: "r1", acceptanceCriteria: []
    })).toThrow();
  });

  it("accepts optional fields", () => {
    const req = DelegationRequestSchema.parse({
      missionId: "m01", sliceId: "s1", roleId: "r1",
      acceptanceCriteria: ["tests pass"],
      parentSeatId: "seat-123",
      modelOverride: { family: "Anthropic", model: "claude-sonnet-4", temperature: 0.3, maxTokens: 16384, costTier: "medium" },
      timeoutMs: 1800000,
      artifacts: ["src/checkout.tsx", "tests/checkout.test.tsx"],
      dependencies: ["02-auth-flow"],
    });
    expect(req.artifacts).toHaveLength(2);
  });
});

describe("QueueEntry", () => {
  it("tracks status transitions", () => {
    const entry = QueueEntrySchema.parse({
      id: "q-123",
      request: { missionId: "m", sliceId: "s", roleId: "r", acceptanceCriteria: ["ok"] },
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    expect(entry.status).toBe("pending");
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `pnpm vitest run packages/contracts/src/delegation.test.ts`
Expected: FAIL

- [ ] **Step 2.3: Implement `delegation.ts` in contracts**

Define:
- `DelegationRequestSchema` (missionId, sliceId, roleId, acceptanceCriteria: string[], parentSeatId?, modelOverride?, timeoutMs?, artifacts?, dependencies?)
- `DelegationResultSchema` (success: boolean, artifacts: string[], logs: string[], error?: string)
- `QueueEntrySchema` (id, request, status: 'pending'|'assigned'|'running'|'done'|'failed'|'blocked', assignedBotId?, worktreePath?, createdAt, startedAt?, completedAt?, result?)
- Export all

- [ ] **Step 2.4: Create `packages/delegation-queue` package**

`package.json`:
```json
{
  "name": "@rakazo/delegation-queue",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/queue.ts",
  "types": "./src/queue.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": { "@rakazo/contracts": "workspace:*" },
  "devDependencies": { "vitest": "workspace:*", "typescript": "workspace:*" }
}
```

- [ ] **Step 2.5: Implement `queue.ts` with Queue class**

```typescript
// packages/delegation-queue/src/queue.ts
import { DelegationRequest, QueueEntry, DelegationResult } from "@rakazo/contracts";

export class DelegationQueue {
  private entries = new Map<string, QueueEntry>();
  private persister?: QueuePersister;

  constructor(persister?: QueuePersister) { this.persister = persister; }

  async enqueue(request: DelegationRequest): Promise<QueueEntry> {
    const entry: QueueEntry = {
      id: crypto.randomUUID(),
      request,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.entries.set(entry.id, entry);
    await this.persist();
    return entry;
  }

  async assign(entryId: string, botId: string, worktreePath: string): Promise<QueueEntry> {
    const entry = this.entries.get(entryId);
    if (!entry) throw new Error(`Queue entry ${entryId} not found`);
    entry.status = "assigned";
    entry.assignedBotId = botId;
    entry.worktreePath = worktreePath;
    entry.startedAt = new Date().toISOString();
    await this.persist();
    return entry;
  }

  async complete(entryId: string, result: DelegationResult): Promise<QueueEntry> {
    const entry = this.entries.get(entryId);
    if (!entry) throw new Error(`Queue entry ${entryId} not found`);
    entry.status = result.success ? "done" : "failed";
    entry.result = result;
    entry.completedAt = new Date().toISOString();
    await this.persist();
    return entry;
  }

  get(entryId: string) { return this.entries.get(entryId); }
  list(filter?: Partial<Pick<QueueEntry, "status" | "assignedBotId">>) {
    return [...this.entries.values()].filter(e => 
      (!filter?.status || e.status === filter.status) &&
      (!filter?.assignedBotId || e.assignedBotId === filter.assignedBotId)
    );
  }

  private async persist() { if (this.persister) await this.persister.save([...this.entries.values()]); }
}

export interface QueuePersister {
  save(entries: QueueEntry[]): Promise<void>;
  load(): Promise<QueueEntry[]>;
}
```

- [ ] **Step 2.6: Write queue tests**

```typescript
// packages/delegation-queue/src/queue.test.ts
import { DelegationQueue } from "./queue.js";
import { DelegationRequestSchema } from "@rakazo/contracts";

describe("DelegationQueue", () => {
  it("enqueues and assigns", async () => {
    const q = new DelegationQueue();
    const req = DelegationRequestSchema.parse({ missionId: "m", sliceId: "s", roleId: "r", acceptanceCriteria: ["ok"] });
    const entry = await q.enqueue(req);
    expect(entry.status).toBe("pending");
    const assigned = await q.assign(entry.id, "bot-123", "/tmp/worktree");
    expect(assigned.status).toBe("assigned");
    expect(assigned.assignedBotId).toBe("bot-123");
  });

  it("completes with result", async () => {
    const q = new DelegationQueue();
    const req = DelegationRequestSchema.parse({ missionId: "m", sliceId: "s", roleId: "r", acceptanceCriteria: ["ok"] });
    const entry = await q.enqueue(req);
    await q.assign(entry.id, "bot-123", "/tmp/wt");
    const done = await q.complete(entry.id, { success: true, artifacts: ["a.ts"], logs: ["done"] });
    expect(done.status).toBe("done");
    expect(done.result?.success).toBe(true);
  });
});
```

- [ ] **Step 2.7: Run tests**

Run: `pnpm test --filter=@rakazo/delegation-queue`
Expected: PASS

- [ ] **Step 2.8: Commit**

```bash
git add packages/contracts/src/delegation.ts packages/contracts/src/delegation.test.ts packages/delegation-queue/
git commit -m "feat: add delegation queue with acceptance criteria"
```

---

## Task 3: Jev Merge Gate (Local Gate Runner)

**Files:**
- Create: `packages/jev-gate/src/merge-gate.ts`
- Create: `packages/jev-gate/src/merge-gate.test.ts`
- Create: `packages/jev-gate/package.json`
- Modify: `package.json` (add workspace package)
- Modify: `packages/adapters/src/jev-auto-review.ts` (extract reusable gate logic)

**Interfaces:**
- Consumes: `MergeGateInput`, `GateRequirement`, `GateResult` from contracts (new)
- Produces: `JevMergeGate` class with `evaluate()` method

- [ ] **Step 3.1: Add gate types to contracts**

Create `packages/contracts/src/merge-gate.ts`:
- `GateRequirementSchema` (name: 'ci'|'two-family-review'|'qa-verdict'|'jev-decision', required: boolean, timeoutMs?)
- `GateResultSchema` (name, status: 'pass'|'fail'|'pending'|'skipped', evidence: Record<string,unknown>, decidedAt?)
- `MergeGateInputSchema` (prNumber, headSha, baseSha, requiredGates: GateRequirement[])
- `MergeGateOutputSchema` (allowed: boolean, results: GateResult[])

Export from `index.ts`, add tests in `merge-gate.test.ts`.

- [ ] **Step 3.2: Create `packages/jev-gate` package**

`package.json` with deps: `@rakazo/contracts`, `@rakazo/adapters` (for jev-auto-review)

- [ ] **Step 3.3: Implement `merge-gate.ts`**

```typescript
// packages/jev-gate/src/merge-gate.ts
import { MergeGateInput, MergeGateOutput, GateResult, GateRequirement } from "@rakazo/contracts";
import { runJevReview } from "@rakazo/adapters/jev-auto-review.js"; // existing function

export class JevMergeGate {
  async evaluate(input: MergeGateInput): Promise<MergeGateOutput> {
    const results = await Promise.all(
      input.requiredGates.map(gate => this.runGate(gate, input))
    );
    const allRequiredPass = results
      .filter((_, i) => input.requiredGates[i].required)
      .every(r => r.status === "pass");
    return { allowed: allRequiredPass, results };
  }

  private async runGate(gate: GateRequirement, input: MergeGateInput): Promise<GateResult> {
    const base = { name: gate.name, status: "pending" as const, evidence: {} as Record<string,unknown> };
    switch (gate.name) {
      case "ci":
        return { ...base, status: await this.checkCI(input.headSha) ? "pass" : "fail", evidence: { sha: input.headSha } };
      case "two-family-review":
        return { ...base, status: await this.checkTwoFamilyReview(input.prNumber) ? "pass" : "fail", evidence: { pr: input.prNumber } };
      case "qa-verdict":
        return { ...base, status: await this.checkQAVerdict(input.headSha) ? "pass" : "fail", evidence: { sha: input.headSha } };
      case "jev-decision":
        const jevResult = await runJevReview({ prNumber: input.prNumber, headSha: input.headSha });
        return { ...base, status: jevResult.approved ? "pass" : "fail", evidence: jevResult.reasoning, decidedAt: new Date().toISOString() };
      default:
        return { ...base, status: "skipped", evidence: { reason: "unknown gate" } };
    }
  }

  private async checkCI(sha: string): Promise<boolean> { /* query CI status */ return true; }
  private async checkTwoFamilyReview(pr: number): Promise<boolean> { /* query review status */ return true; }
  private async checkQAVerdict(sha: string): Promise<boolean> { /* query QA result */ return true; }
}
```

- [ ] **Step 3.4: Write tests mocking the gate checks**

Test each gate, test `allowed: false` when any required gate fails.

- [ ] **Step 3.5: Run tests**

Run: `pnpm test --filter=@rakazo/jev-gate`
Expected: PASS

- [ ] **Step 3.6: Commit**

```bash
git add packages/contracts/src/merge-gate.ts packages/contracts/src/merge-gate.test.ts packages/jev-gate/
git commit -m "feat: add Jev-powered local merge gate"
```

---

## Task 4: Team Template Sync (Git-based Bootstrap)

**Files:**
- Create: `packages/team-sync/src/bootstrap.ts`
- Create: `packages/team-sync/src/bootstrap.test.ts`
- Create: `packages/team-sync/src/template.ts` (types)
- Create: `packages/team-sync/package.json`
- Modify: `package.json` (add workspace package)

**Interfaces:**
- Consumes: `BotRole`, `AgentSkill`, `McpServerConfigInput`, `Routine` from contracts
- Produces: `TeamTemplate`, `TeamBootstrapper` class

- [ ] **Step 4.1: Define `TeamTemplate` types in `template.ts`**

```typescript
// packages/team-sync/src/template.ts
import { BotRole, AgentSkill, McpServerConfigInput, Routine } from "@rakazo/contracts";

export interface TeamTemplate {
  version: string;
  roles: BotRole[];
  skills: Array<{ name: string; version: string; source: string }>;
  routines: Array<Omit<Routine, "id" | "botId" | "createdAt" | "updatedAt"> & { template: boolean }>;
  mcpServers: McpServerConfigInput[];
  policies: { approval: object; security: object };
  computerDefaults: { kind: "docker" | "desktop"; cpu: number; memory: number };
}
```

- [ ] **Step 4.2: Implement `bootstrap.ts`**

```typescript
// packages/team-sync/src/bootstrap.ts
import { TeamTemplate } from "./template.js";
import { BotRoleRegistry } from "@rakazo/contracts";

export class TeamBootstrapper {
  constructor(private roleRegistry: BotRoleRegistry) {}

  async bootstrap(repoUrl: string, teamName: string, targetDir: string): Promise<void> {
    // 1. git clone --depth=1 --branch=main
    // 2. load template.yaml from targetDir
    // 3. validate template (zod)
    // 4. render with { teamName, targetDir } (replace placeholders)
    // 5. register roles in roleRegistry
    // 6. install skills (call skill install API)
    // 7. write .rakazo/team-lock.json with pinned versions
    // 8. init queue worktrees structure
  }
}
```

- [ ] **Step 4.3: Write tests with temp git repo fixture**

Test: clone, render, register roles, write lock file.

- [ ] **Step 4.4: Run tests**

Run: `pnpm test --filter=@rakazo/team-sync`
Expected: PASS

- [ ] **Step 4.5: Commit**

```bash
git add packages/team-sync/
git commit -m "feat: add team template sync with git bootstrap"
```

---

## Task 5: Credential Guard (Runtime Hook)

**Files:**
- Create: `packages/credential-guard/src/guard.ts`
- Create: `packages/credential-guard/src/guard.test.ts`
- Create: `packages/credential-guard/src/config.ts`
- Create: `packages/credential-guard/package.json`
- Modify: `package.json` (add workspace package)
- Modify: `packages/adapters/src/executor.ts` (integrate guard in tool dispatch)

**Interfaces:**
- Consumes: config from `~/.rakazo/credential-guard.yaml`
- Produces: `CredentialGuard` class with `sanitizeInput()`, `sanitizeOutput()`, `sanitizeTranscript()`

- [ ] **Step 5.1: Write failing tests**

```typescript
// packages/credential-guard/src/guard.test.ts
import { CredentialGuard } from "./guard.js";

describe("CredentialGuard", () => {
  it("redacts MYAPP_DB_PASSWORD from input", () => {
    const guard = new CredentialGuard();
    const { clean, blocked } = guard.sanitizeInput('run("MYAPP_DB_PASSWORD=secret123")');
    expect(clean).toContain("[REDACTED:MYAPP_DB_PASSWORD]");
    expect(blocked).toBe(true);
  });

  it("redacts AWS keys", () => {
    const guard = new CredentialGuard();
    const { clean } = guard.sanitizeInput('AKIA1234567890ABCDEF');
    expect(clean).toBe("[REDACTED:AWS_KEY]");
  });

  it("redacts GitHub tokens", () => {
    const guard = new CredentialGuard();
    const { clean } = guard.sanitizeInput('ghp_abcdefghijklmnopqrstuvwxyz123456');
    expect(clean).toBe("[REDACTED:GH_TOKEN]");
  });

  it("sanitizes transcript output", () => {
    const guard = new CredentialGuard();
    const out = guard.sanitizeOutput('{"stdout": "DB connected with password=hunter2"}');
    expect(out).toContain("[REDACTED");
  });

  it("loads custom patterns from config", () => {
    const guard = new CredentialGuard([{ name: "custom", regex: /SECRET_\w+/g, replacement: "[CUSTOM]", severity: "block" }]);
    const { clean, blocked } = guard.sanitizeInput("SECRET_API_KEY=xyz");
    expect(clean).toBe("[CUSTOM]");
    expect(blocked).toBe(true);
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `pnpm vitest run packages/credential-guard/src/guard.test.ts`
Expected: FAIL

- [ ] **Step 5.3: Implement `guard.ts`**

```typescript
// packages/credential-guard/src/guard.ts
interface SecretPattern { name: string; regex: RegExp; replacement: string; severity: "warn" | "block"; }
interface Finding { pattern: string; count: number; severity: "warn" | "block"; }

const DEFAULT_PATTERNS: SecretPattern[] = [
  { name: "env-var", regex: /(^|\s)([A-Z_]+_(PASSWORD|SECRET|TOKEN|KEY))=(\S+)/g, replacement: '$1$2=[REDACTED]', severity: "block" },
  { name: "aws-key", regex: /AKIA[0-9A-Z]{16}/g, replacement: "[REDACTED:AWS_KEY]", severity: "block" },
  { name: "github-token", regex: /gh[ps]_[a-zA-Z0-9]{36}/g, replacement: "[REDACTED:GH_TOKEN]", severity: "block" },
  { name: "private-key", regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g, replacement: "[REDACTED:PRIVATE_KEY]", severity: "block" },
];

export class CredentialGuard {
  constructor(private patterns: SecretPattern[] = DEFAULT_PATTERNS) {}

  sanitizeInput(input: string): { clean: string; blocked: boolean; findings: Finding[] } {
    const findings: Finding[] = [];
    let clean = input;
    let blocked = false;
    for (const p of this.patterns) {
      const matches = [...input.matchAll(p.regex)];
      if (matches.length) {
        findings.push({ pattern: p.name, count: matches.length, severity: p.severity });
        clean = clean.replace(p.regex, p.replacement);
        if (p.severity === "block") blocked = true;
      }
    }
    return { clean, blocked, findings };
  }

  sanitizeOutput(output: string): string {
    return this.sanitizeInput(output).clean;
  }
}
```

- [ ] **Step 5.4: Implement `config.ts` for YAML loading**

Load `~/.rakazo/credential-guard.yaml` on init, merge with defaults.

- [ ] **Step 5.5: Integrate into `executor.ts`**

In `executor.ts` tool dispatch (around line where tools are called):
```typescript
// Before tool execution
const { clean, blocked, findings } = credentialGuard.sanitizeInput(JSON.stringify(args));
if (blocked) throw new SecurityError(`Credential Guard blocked: ${findings.map(f=>f.pattern).join(", ")}`);

// After tool execution, before transcript log
const sanitizedResult = credentialGuard.sanitizeOutput(JSON.stringify(result));
await appendTranscript({ tool, args: JSON.parse(clean), result: JSON.parse(sanitizedResult) });
```

- [ ] **Step 5.6: Run tests**

Run: `pnpm test --filter=@rakazo/credential-guard && pnpm test --filter=@rakazo/adapters`
Expected: PASS

- [ ] **Step 5.7: Commit**

```bash
git add packages/credential-guard/ packages/adapters/src/executor.ts
git commit -m "feat: add credential guard runtime hooks for secret redaction"
```

---

## Task 6: Integration & E2E Verification

**Files:**
- Create: `packages/testkit/src/multi-bot-e2e.test.ts`
- Modify: `packages/adapters/src/executor.ts` (wire delegation queue spawn)

**Interfaces:**
- Consumes: All previous tasks
- Produces: End-to-end test proving a delegation flow with role, queue, gate, guard

- [ ] **Step 6.1: Write E2E test scenario**

```typescript
// "e-commerce-store" team bootstrap → role registry populated
// Coordinator creates DelegationRequest for "03-checkout-form" with acceptanceCriteria
// Queue enqueues, assigns to impl-bot with role "checkout-implementer"
// Bot runs in worktree, executes tools (credential guard active)
// PR opened → JevMergeGate evaluates → all gates pass → merge allowed
```

- [ ] **Step 6.2: Run E2E test**

Run: `pnpm test:integration` (or specific test file)
Expected: PASS

- [ ] **Step 6.3: Full test suite + lint + typecheck**

Run: `pnpm test && pnpm check`
Expected: All green

- [ ] **Step 6.4: Commit**

```bash
git add packages/testkit/src/multi-bot-e2e.test.ts
git commit -m "test: multi-bot orchestration e2e verification"
```

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-10-03-multi-bot-orchestration-gaps.md`.**

Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** - A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** - I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

**For this plan I recommend Subagent-driven**, because the 6 tasks have clear interface boundaries (contracts → queue → gate → sync → guard → integration) and a shipped mistake in credential handling or merge gates would be a security/compliance risk. Independent review per task catches interface mismatches early.

Does the plan capture what you want, and which approach should we use?