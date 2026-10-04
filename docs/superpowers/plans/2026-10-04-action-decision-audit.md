# Entscheidungs-Audit und Fail-closed-Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jede Gate-Entscheidung über eine Bot-Werkzeugaktion wird append-only in Postgres protokolliert, und der stillschweigende `allow`-Default ohne passende Regel wird zunachst gemessen, dann hinter einem Deployment-Flag auf `ask` (fail-closed) umgestellt.

**Architecture:** Der Resolver in `@rakazo/core` bekommt einen optionalen `failClosed`-Schalter und bleibt rein. Der Executor faellt die Entscheidung an seiner bestehenden Stelle, schreibt aber vor der Effekt-Claim einen Entscheidungs-Rekord (`action_decisions`: Entscheidung, Quelle, passende Regeln, ob dieselbe Anfrage unter Fail-closed verboten worden waere) in eine per SQL-Trigger append-only gemachte Tabelle. Das Flag `RAKAZO_ACTION_FAIL_CLOSED` steuert ausschliesslich die Durchsetzung, nie die Aufzeichnung — die Aufzeichnung laeuft immer, damit der Flip auf Messdaten statt Gefuehl trifft.

**Tech Stack:** TypeScript, Prisma (PostgreSQL), Vitest, Biome, pnpm workspaces.

**Spec:** Es gibt keine separate Spec-Datei; der Auftrag liegt im Abschnitt «Ausgangslage» unten. Beide Dokumente (Plan + Ausgangslage) lesen Executors zusammen.

## Ausgangslage

Belege aus diesem Repo, Stand `68c4ad03`:

- `packages/core/src/action-approval.ts:192-194` liefert bei null passenden Regeln `{ decision: "allow", source: "default", matchingRules }`. Das ist fail-open: ein Werkzeug, fuer das niemand eine Regel geschrieben hat, läuft stillschweigend.
- `packages/db/prisma/schema.prisma` fuehrt `ActionApprovalRule` (:117), `Event` (:534) und `TrustPolicy` (:1385), aber **kein** Modell fuer eine Policy-Entscheidung. Der einzige Nachweis einer Pruefung liegt als Spalten auf `ExternalEffect` (`reviewDecision`, `reviewReason`, `reviewModel`, :703-722), geschrieben in `packages/adapters/src/executor.ts:2304-2311` — und nur fuer den Judge-Pfad, nicht fuer die Regel-Entscheidung selbst.
- Der Vergleichspunkt (CopilotKit/openbot, v0.1.0, nur als Spezifikation uebernommen, kein Code): fehlende Policy = deny, kaputte Regel = deny, deny schlägt allow, `mode: dry-run|enforce`, und die Entscheidung wird **vor** der Tat in eine append-only `audit_events` geschrieben. Wir uebernehmen diese Semantik, nicht ihren Code — ihre `gateway.ts` haengt an audit/schema/approvals und alle ihre Workspaces sind privat.

Bewusste Abweichung von openbot: fail-closed heisst bei uns `ask`, nicht hartes `deny`. `ask` ist in rakazo bereits die harte Schwelle (Mensch entscheidet, Run pausiert), und ein hartes `deny` würde unbeaufsichtigte Wakings stumm zerstören.

## Global Constraints

- Kein Hosted-Vendor im Kernpfad; alles bleibt selbst-hostbar (`AGENTS.md`, Regel „No hosted vendor is required to run the core product").
- Kein neues Entscheidungsmodell und kein Router: es wird keine Klassifikation erfunden, nur die vorhandene Regelaufloesung schaerfer gestellt. Das `decision-gate`-Skill wird dadurch nicht ausgeloest.
- Fail-closed bleibt **OFF**, bis die Aufzeichnung zeigt, welche Werkzeuge betroffen sind (`AGENTS.md`: neue Fahigkeit hinter eigenem Flag, aus bis sie gewinnt).
- Nur die Minimal-Copy: dieser Plan fuegt **keinen** neuen sichtbaren Text und **keinen** i18n-Key hinzu. `Denied` existiert bereits (`apps/web/src/components/AskCard.tsx:25`).
- `import type` auf Top-Level-Ebene, nie inline.
- Tests deterministisch und offline; alles, was echte Postgres braucht, laeuft in `*.postgres.test.ts` mit dem bestehenden Env-Gating (`VERIFY_DATABASE=1` und `DATABASE_URL`). Solche Tests liegen beim Code, den sie pruefen: in `packages/db/src` (Konvention: `packages/db/src/messaging.postgres.test.ts`) ebenso wie in `packages/testkit`.
- Verifikation pro Task: `pnpm --filter @rakazo/core test`, `pnpm --filter @rakazo/adapters test`, `pnpm --filter @rakazo/db test`, `pnpm check`, `pnpm lint` (Biome, Wurzel).
- Arbeitsbaum enthaelt parallele Edits eines anderen Prozesses (u. a. `apps/api/src/router.ts`, `packages/contracts/src/domain.ts`, `apps/web/src/pages/mcp-presets.ts`, `bot-library/*`). Nur die in diesem Plan genannten Pfade stagen; niemals `git add -A`.

---

## File Structure

| Datei | Verantwortung |
| --- | --- |
| `packages/core/src/action-approval.ts` (modifizieren) | Reine Regelaufloesung; neu: `failClosed`-Eingang und `deploymentActionFailClosed(env)` |
| `packages/core/src/action-approval.test.ts` (modifizieren) | Verhalten des Defaults, inkl. Flag-Parser |
| `packages/db/prisma/schema.prisma` (modifizieren) | Modell `ActionDecision` (Tabelle `action_decisions`) |
| `packages/db/prisma/migrations/<ts>/migration.sql` (neu) | Tabelle + append-only-Trigger + Rechteentzug |
| `packages/adapters/src/action-decision-row.ts` (neu) | Reiner Übersetzer Gate-Zustand → Prisma-`data`-Objekt |
| `packages/adapters/src/action-decision-row.test.ts` (neu) | Zeilenform,Dry-Run-Auslegung |
| `packages/adapters/src/executor.ts` (modifizieren) | Entscheidungspunkt :2159-2194, Schreiben vor Claim :2362 |
| `packages/testkit/src/computer-approval.postgres.test.ts` (modifizieren) | Nachweis, dass pro Gate eine Zeile entsteht |
| `docs/self-host.md`, `.env.example` (modifizieren) | Flag, Auswertung ab frage |

---

### Task 1: Fail-closed-Default im Resolver und sein Deployment-Flag

**Files:**
- Modify: `packages/core/src/action-approval.ts:182-194`
- Test: `packages/core/src/action-approval.test.ts`

**Interfaces:**
- Consumes: nichts (Modul ist die unterste Schicht).
- Produces:
  - `resolveActionApprovalDetail(input: { toolName: string; connectorKind?: string; readOnly?: boolean; rules: ActionApprovalRule[]; failClosed?: boolean }): ActionApprovalResolved`
  - `deploymentActionFailClosed(env?: NodeJS.ProcessEnv): boolean`
  - `ActionApprovalResolved` bleibt unveraendert (`decision: "ask" | "allow"`, `source: "require_approval" | "always_allow" | "default"`, `matchingRules`).

- [ ] **Step 1: Schlage die bestehenden Tests nach und schreibe drei neue failing tests**

Fuege am Ende von `describe("resolveActionApproval", …)` (Datei `packages/core/src/action-approval.test.ts`) hinzu:

```ts
  it("allows by default while the deployment runs fail-open", () => {
    expect(
      resolveActionApprovalDetail({ toolName: "some_unruled_tool", rules: [] }).decision,
    ).toBe("allow");
  });

  it("asks instead of silently allowing when the deployment runs fail-closed", () => {
    const resolved = resolveActionApprovalDetail({
      toolName: "some_unruled_tool",
      rules: [],
      failClosed: true,
    });
    expect(resolved.decision).toBe("ask");
    expect(resolved.source).toBe("default");
  });

  it("keeps an explicit always-allow rule above the fail-closed default", () => {
    const rules: ActionApprovalRule[] = [
      { effect: "always_allow", matchKind: "tool", matchValue: "some_unruled_tool" },
    ];
    const resolved = resolveActionApprovalDetail({
      toolName: "some_unruled_tool",
      rules,
      failClosed: true,
    });
    expect(resolved.decision).toBe("allow");
    expect(resolved.source).toBe("always_allow");
  });
```

- [ ] **Step 2: Schreibe einen failing test fuer das Flag**

Fuege in derselben Datei ganz unten einen neuen Block hinzu (der Import oben um `deploymentActionFailClosed` erweitern):

```ts
describe("deploymentActionFailClosed", () => {
  it("is off unless the deployment turns it on", () => {
    expect(deploymentActionFailClosed({})).toBe(false);
    expect(deploymentActionFailClosed({ RAKAZO_ACTION_FAIL_CLOSED: "false" })).toBe(false);
  });

  it("reads the same spellings as the other deployment flags", () => {
    for (const value of ["1", "true", "yes", "on"]) {
      expect(deploymentActionFailClosed({ RAKAZO_ACTION_FAIL_CLOSED: value })).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @rakazo/core test`
Expected: FAIL mit `failClosed` als unbekanntem Property bzw. `deploymentActionFailClosed is not exported`.

- [ ] **Step 4: Implementiere den Resolver-Zweig**

In `packages/core/src/action-approval.ts` die Signatur und den Leer-Regel-Zweig ersetzen (aktuell :182-194):

```ts
export function resolveActionApprovalDetail(input: {
  toolName: string;
  connectorKind?: string;
  readOnly?: boolean;
  rules: ActionApprovalRule[];
  /** Fail-closed deployments never allow a tool that no rule covers. */
  failClosed?: boolean;
}): ActionApprovalResolved {
  const connectorKind = input.connectorKind ?? connectorKindFromToolName(input.toolName);
  const matchingRules = input.rules.filter((rule) =>
    ruleMatches(rule, input.toolName, connectorKind, input.readOnly),
  );
  if (matchingRules.length === 0) {
    return {
      decision: input.failClosed ? "ask" : "allow",
      source: "default",
      matchingRules,
    };
  }
```

Der Rest der Funktion (Specifity, winners, :196-201) bleibt unveraendert.

- [ ] **Step 5: Implementiere das Flag**

Am Ende derselben Datei, direkt vor `planActionGate`:

```ts
/**
 * Deployment-wide rollout switch. Recorded decisions do not depend on it; only enforcement does.
 */
export function deploymentActionFailClosed(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.RAKAZO_ACTION_FAIL_CLOSED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}
```

`packages/core/src/index.ts:1` enthaelt bereits `export * from "./action-approval.js";` — kein Export-Schritt needed. Pruefen mit `grep -n 'action-approval' packages/core/src/index.ts`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @rakazo/core test && pnpm --filter @rakazo/core check`
Expected: PASS. Bestehende Fail-open-Erwartungen im File bleiben gruen, weil `failClosed` optional ist.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/action-approval.ts packages/core/src/action-approval.test.ts
git commit -m "feat(core): let a fail-closed deployment gate unruled tools"
```

---

### Task 2: Entscheidungstabelle in Postgres

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (Modell `Space` und neuer Modellblock)
- Create: `packages/db/prisma/migrations/<timestamp>_action_decisions/migration.sql`
- Test: `packages/db/src/action-decisions.postgres.test.ts` (neu, Schritt 5)

**Interfaces:**
- Consumes: nichts.
- Produces: `prisma.actionDecision` mit den Feldern `id, spaceId, botId, threadId?, runId?, effectId?, toolName, connectorKind, decision, source, enforced, wouldDeny, matchingRules (Json), createdAt`. Prisma-Client wird in Task 4/5 typisiert genutzt.

- [ ] **Step 1: Modell anlegen**

In `packages/db/prisma/schema.prisma` direkt nach `model ActionApprovalRule` (endet :131) einfügen. Muster folgt `model Event` (:534-551): `botId`/`threadId`/`runId` bleiben ohne Fremdschluessel, damit ein Entscheid auch nach dem Loeschen eines Threads weiterzaehlt und die Tabelleappend-only bleiben kann.

```prisma
model ActionDecision {
  id            String   @id @default(cuid())
  spaceId       String
  botId         String
  threadId      String?
  runId         String?
  effectId      String?
  toolName      String
  connectorKind String
  decision      String
  source        String
  enforced      Boolean
  wouldDeny     Boolean
  matchingRules Json
  createdAt     DateTime @default(now())

  @@index([spaceId, createdAt])
  @@index([runId])
  @@map("action_decisions")
}
```

Kein `space Space @relation(...)`: ein Fremdschluessel mit `onDelete: Cascade` wuerde beim Loeschen
eines Space einen `DELETE` auf der append-only-Tabelle ausloesen, den ihr Trigger verweigert —
Space- und Account-Loeschung brachen. `spaceId` bleibt ohne Fremdschluessel, wie oben; die
Rueckbeziehung `actionDecisions ActionDecision[]` in `model Space` entfaellt damit.

- [ ] **Step 2: Migration erzeugen und Trigger handschriftlich nachziehen**

Run: `pnpm --filter @rakazo/db migrate:dev --name action_decisions`
Expected: neuer Ordner `packages/db/prisma/migrations/<timestamp>_action_decisions/`, generierter SQL-Teil mit `CREATE TABLE "action_decisions"` und den beiden Indizes. Der Timestamp-Präfix wird von Prisma gesetzt; Tests haengen nicht am Ordnernamen.

Fuege in dieselbe Migrationsdatei am Ende an (append-only ist der Grund fuer die Tabelle; Vorbild fuer Trigger-Syntax ist `packages/db/prisma/migrations/20260830200000_space_scope_names_and_user_credentials/migration.sql:49,69`):

```sql
-- Decisions are a record of what was allowed. Mutating or removing one would rewrite history,
-- so the database refuses it even if a future caller gets the idea.
CREATE FUNCTION "prevent_action_decision_mutation"() RETURNS trigger
    LANGUAGE plpgsql AS
    $$
    BEGIN
        RAISE EXCEPTION 'action_decisions is append-only';
    END
    $$;

CREATE TRIGGER "action_decision_append_only"
    BEFORE UPDATE OR DELETE ON "action_decisions"
    FOR EACH ROW EXECUTE FUNCTION "prevent_action_decision_mutation"();

REVOKE UPDATE, DELETE, TRUNCATE ON "action_decisions" FROM PUBLIC;
```

- [ ] **Step 3: Client neu generieren**

Run: `pnpm db:generate`
Expected: kein Fehler; `actionDecision` ist im generierten Client sichtbar (`packages/db/src/generated/prisma`).

- [ ] **Step 4: Run the deploy-migration smoke the repo already uses**

Run: `pnpm --filter @rakazo/db test`
Expected: PASS (Unit-Suite ohne echte DB bleibt unberuehrt).

- [ ] **Step 5: append-only gegen echte Postgres beweisen**

Create `packages/db/src/action-decisions.postgres.test.ts` — diese Suite braucht eine echte DB und folgt dem bestehenden Gating-Muster aus `packages/testkit/src/computer-approval.postgres.test.ts:13-16`. Sie liegt bewusst in `packages/db/src`, weil sie nur SQL prueft:

```ts
import { PrismaClient } from "./generated/prisma/client.js";
import { describe, expect, it } from "vitest";

const databaseAvailable = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!databaseAvailable)("action_decisions append-only", () => {
  it("accepts a decision row and refuses to change one", async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
    try {
      const created = await prisma.actionDecision.create({
        data: {
          spaceId: "fixture-space",
          botId: "fixture-bot",
          toolName: "fixture_tool",
          connectorKind: "fixture",
          decision: "ask",
          source: "default",
          enforced: false,
          wouldDeny: true,
          matchingRules: [],
        },
      });
      await expect(
        prisma.actionDecision.update({ where: { id: created.id }, data: { decision: "allow" } }),
      ).rejects.toThrow("action_decisions is append-only");
      await expect(prisma.actionDecision.delete({ where: { id: created.id } })).rejects.toThrow(
        "action_decisions is append-only",
      );
    } finally {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "action_decisions" WHERE id = 'fixture'`,
      );
      await prisma.$disconnect();
    }
  });
});
```

Hinweis (Korrektur nach der Ganzer-Branch-Review): Der Trigger macht `DELETE` unerreichbar und ein
FK-Cascade feuert denselben Trigger, deshalb darf diese Suite NIE etwas wegzuloeschen versuchen — jede
Verweigerung bekommt ihre eigene interaktive Transaktion mit eigener Fixture (Space per
`tx.space.create`, Organisation per `tx.organization.create`) und wird ueber ein non-enumerables
`Symbol`-Sentinel zurueckgerollt, das ausserhalb der Transaktion erwartet wird. Zwei getrennte
Transaktionen, weil eine fehlgeschlagene Write den PostgreSQL-Transaktions abortiert (`25P02`) und die
zweite Erwartung dann nicht mehr dieselbe Meldung fuehrt. Raum- und Account-Loeschung bekommen einen
eigenen Fall: Space mit Entscheidungs-Zeile loeschen muss gelingen und die Zeile muss zaehlen bleiben —
das ist der Regressionsnachweis dafuer, dass `spaceId` ohne Fremdschluessel ist.

- [ ] **Step 6: Run test to verify it passes**

Run: `VERIFY_DATABASE=1 DATABASE_URL="$DATABASE_URL" pnpm --filter @rakazo/db test` ( ohne echte DB: `pnpm --filter @rakazo/db test`, Suite skippt sichtbar)
Expected: PASS mit echter DB; ohne DB `skipped`, kein Fehler.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/action-decisions.postgres.test.ts
git commit -m "feat(db): record action decisions in an append-only table"
```

---

### Task 3: Zeilenuebersetzer — was das Dry-Run erzaehlen soll

**Files:**
- Create: `packages/adapters/src/action-decision-row.ts`
- Test: `packages/adapters/src/action-decision-row.test.ts`

**Interfaces:**
- Consumes: `ActionApprovalResolved` und `ActionApprovalSource` aus `@rakazo/core` (Task 1).
- Produces:
  - `interface ActionGateOutcome { spaceId: string; botId: string; threadId?: string; runId?: string; effectId?: string; toolName: string; connectorKind: string; resolved: ActionApprovalResolved; gateDecision: "ask" | "allow"; failClosed: boolean; }`
  - `buildActionDecisionRow(outcome: ActionGateOutcome): { spaceId: string; botId: string; threadId: string | null; runId: string | null; effectId: string | null; toolName: string; connectorKind: string; decision: "ask" | "allow"; source: ActionApprovalSource; enforced: boolean; wouldDeny: boolean; matchingRules: { effect: string; matchKind: string; matchValue: string }[] }`

Diese Form ist exakt der `data`-Block von `prisma.actionDecision.create` (Task 2), damit Task 5 keine Uebersetzung mehr braucht.

- [ ] **Step 1: Write the failing test**

Create `packages/adapters/src/action-decision-row.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildActionDecisionRow } from "./action-decision-row.js";

const resolved = {
  decision: "allow" as const,
  source: "default" as const,
  matchingRules: [],
};

describe("buildActionDecisionRow", () => {
  it("marks a silent default allow as something fail-closed would have stopped", () => {
    const row = buildActionDecisionRow({
      spaceId: "space-1",
      botId: "bot-1",
      toolName: "gmail_send_email",
      connectorKind: "gmail",
      resolved,
      gateDecision: "allow",
      failClosed: false,
    });
    expect(row.decision).toBe("allow");
    expect(row.source).toBe("default");
    expect(row.enforced).toBe(false);
    expect(row.wouldDeny).toBe(true);
  });

  it("never reports wouldDeny once fail-closed is in force", () => {
    const row = buildActionDecisionRow({
      spaceId: "space-1",
      botId: "bot-1",
      toolName: "gmail_send_email",
      connectorKind: "gmail",
      resolved: { ...resolved, decision: "ask" },
      gateDecision: "ask",
      failClosed: true,
    });
    expect(row.enforced).toBe(true);
    expect(row.wouldDeny).toBe(false);
  });

  it("leaves wouldDeny false when a rule decided the outcome", () => {
    const row = buildActionDecisionRow({
      spaceId: "space-1",
      botId: "bot-1",
      toolName: "destination.write",
      connectorKind: "destination",
      resolved: {
        decision: "allow",
        source: "always_allow",
        matchingRules: [
          { effect: "always_allow", matchKind: "tool", matchValue: "destination.write" },
        ],
      },
      gateDecision: "allow",
      failClosed: false,
    });
    expect(row.wouldDeny).toBe(false);
    expect(row.matchingRules).toEqual([
      { effect: "always_allow", matchKind: "tool", matchValue: "destination.write" },
    ]);
  });

  it("keeps a missing thread and run as null, not empty string", () => {
    const row = buildActionDecisionRow({
      spaceId: "space-1",
      botId: "bot-1",
      toolName: "some_tool",
      connectorKind: "some",
      resolved,
      gateDecision: "allow",
      failClosed: false,
    });
    expect(row.threadId).toBeNull();
    expect(row.runId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rakazo/adapters test`
Expected: FAIL — `Cannot find module './action-decision-row.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/adapters/src/action-decision-row.ts`:

```ts
import type { ActionApprovalResolved, ActionApprovalSource } from "@rakazo/core";

export interface ActionGateOutcome {
  spaceId: string;
  botId: string;
  threadId?: string;
  runId?: string;
  effectId?: string;
  toolName: string;
  connectorKind: string;
  resolved: ActionApprovalResolved;
  gateDecision: "ask" | "allow";
  failClosed: boolean;
}

export interface ActionDecisionRow {
  spaceId: string;
  botId: string;
  threadId: string | null;
  runId: string | null;
  effectId: string | null;
  toolName: string;
  connectorKind: string;
  decision: "ask" | "allow";
  source: ActionApprovalSource;
  enforced: boolean;
  wouldDeny: boolean;
  matchingRules: { effect: string; matchKind: string; matchValue: string }[];
}

/**
 * `wouldDeny` is the measurement that makes the flip safe: it is true only for a run that was
 * allowed silently, so an operator can count what fail-closed would stop before turning it on.
 */
export function buildActionDecisionRow(outcome: ActionGateOutcome): ActionDecisionRow {
  return {
    spaceId: outcome.spaceId,
    botId: outcome.botId,
    threadId: outcome.threadId ?? null,
    runId: outcome.runId ?? null,
    effectId: outcome.effectId ?? null,
    toolName: outcome.toolName,
    connectorKind: outcome.connectorKind,
    decision: outcome.gateDecision,
    source: outcome.resolved.source,
    enforced: outcome.failClosed,
    wouldDeny: !outcome.failClosed && outcome.gateDecision === "allow" && outcome.resolved.source === "default",
    matchingRules: outcome.resolved.matchingRules.map((rule) => ({
      effect: rule.effect,
      matchKind: rule.matchKind,
      matchValue: rule.matchValue,
    })),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rakazo/adapters test && pnpm --filter @rakazo/adapters check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/src/action-decision-row.ts packages/adapters/src/action-decision-row.test.ts
git commit -m "feat(adapters): describe what fail-closed would have stopped"
```

---

### Task 4: Entscheidungspunkt im Executor verdrahten

**Files:**
- Modify: `packages/adapters/src/executor.ts:2159-2166` (Resolver-Aufruf), `:2362-2364` (Schreiben vor der Claim), Importblock `:56-99`
- Test: `packages/testkit/src/computer-approval.postgres.test.ts`

**Interfaces:**
- Consumes: `deploymentActionFailClosed` (Task 1), `resolveActionApprovalDetail(…, failClosed)` (Task 1), `buildActionDecisionRow` (Task 3), `prisma.actionDecision` (Task 2).
- Produces: pro erreichtem Gate genau eine `action_decisions`-Zeile; die Variable `failClosedActions: boolean` ist im Gate-Scope sichtbar.

- [ ] **Step 1: Write the failing test first by extending the existing postgres approval run**

In `packages/testkit/src/computer-approval.postgres.test.ts` steht bereits ein vollständiger Ablauf: Signup (`:116-126`), Bot (`:133-145`), `actionApprovalRule.create` fuer `computer_act` (`:147-155`), `threads/send` (`:156-159`) und Run-Beobachtung (`:160ff`). Haenge an das Ende desselben Falls (nachden `runId` bekannt und der Run pausiert oder beendet ist) die Beobachtung an — `handles.prisma` ist dort bereits in Gebrauch (`:146`):

```ts
        const decisions = await handles.prisma.actionDecision.findMany({
          where: { spaceId: storedBot.spaceId, toolName: "computer_act" },
          orderBy: { createdAt: "asc" },
        });
        expect(decisions.length).toBeGreaterThan(0);
        expect(decisions.at(-1)?.decision).toBe("ask");
        expect(decisions.at(-1)?.source).toBe("require_approval");
        expect(decisions.at(-1)?.enforced).toBe(false);
        expect(decisions.at(-1)?.wouldDeny).toBe(false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `VERIFY_DATABASE=1 DATABASE_URL="$DATABASE_URL" pnpm vitest run packages/testkit/src/computer-approval.postgres.test.ts`
Expected: FAIL — `decisions.length` ist 0 (bzw. `Unknown action Decision` vor der Migration), weil noch nichts geschrieben wird.

- [ ] **Step 3: Flag und Resolver verdrahten**

In `packages/adapters/src/executor.ts` den Importblock (:56-99, Muster :89 `resolveActionApprovalDetail`) um zwei Namen erweitern:

```ts
  deploymentActionFailClosed,
```

und, direkt bei den anderen Adapter-Importen:

```ts
import { buildActionDecisionRow } from "./action-decision-row.js";
```

Vor dem Gate: das Flag am Entscheidungspunkt lesen, einmal pro Attempt (nicht pro Run). Direkt nach `loadApprovalRules` (:1714-1723) einfügen:

```ts
const failClosedActions = deploymentActionFailClosed();
```

Kein `deps.env` und keine Composition-Root-Aenderung: `deploymentActionFailClosed` liest ueber sein
Default-Argument `process.env`, genau wie der Executor bereits `deploymentAutoReviewDefault()` nutzt —
Deployment-Flags werden im Executor so gelesen, nicht durchgereicht.

Resolver-Aufruf (:2161-2166) erweitern:

```ts
            : resolveActionApprovalDetail({
                toolName: name,
                connectorKind,
                readOnly: declaredReadOnly,
                rules: await loadApprovalRules(),
                failClosed: failClosedActions,
              });
```

- [ ] **Step 4: Zeile vor der Ausfuehrung schreiben**

Die Entscheidung steht spaetestens ab :2362 fest (`gateDecision` kann im Judge-Pfad noch auf `"allow"` springen, :2354). Schreibe genau dort, **vor** `needsApproval` (:2364) und damit vor jeder Claim und jeder Ausfuehrung:

```ts
          if (context.signal.aborted) return pauseForApproval();
          await deps.prisma.actionDecision.create({
            data: buildActionDecisionRow({
              spaceId: run.spaceId,
              botId: run.botId,
              threadId: run.threadId,
              runId: run.id,
              effectId: applied?.effect.id,
              toolName: name,
              connectorKind,
              resolved: approvalResolved,
              gateDecision,
              failClosed: failClosedActions,
            }),
          });

          const needsApproval = gateDecision === "ask";
```

Kein `try/catch`: Ausfall der Aufzeichnung darf die Tat nicht durchlassen — das ist die uebernommene Semantik („an action that was not recorded did not happen"). Die Migration laeuft vor dem Serve (`docs/self-host.md:618`), also ist die Tabelle vorhanden, bevor der erste Run laeuft.

- [ ] **Step 5: Run the whole adapter and database suites**

Run: `pnpm --filter @rakazo/adapters test && pnpm --filter @rakazo/db test && pnpm check`
Expected: PASS. Die bestehenden Executor-Gate-Suiten (`executor-readonly-approval.test.ts`, `executor-approval-replay.test.ts`, `executor-approval-pi.test.ts`, `approval-effect.test.ts`) muessen bleiben wie sie sind; schreiben sie mit einem `prisma`-Stub, der `actionDecision` nicht kennt, ergaenzt dort den Stub um `actionDecision: { create: vi.fn(async () => undefined) }` — das ist die minimalste Aenderung und bestaetigt nebenbei, dass ueberhaupt geschrieben wird.

- [ ] **Step 6: Run test to verify it passes**

Run: `VERIFY_DATABASE=1 DATABASE_URL="$DATABASE_URL" pnpm vitest run packages/testkit/src/computer-approval.postgres.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/adapters/src/executor.ts packages/testkit/src/computer-approval.postgres.test.ts
git commit -m "feat(adapters): record every action decision before it acts"
```

Wenn Step 5 die Deps-Signatur oder die Composition roots angefasst hat, die betroffenen Dateien in denselben Commit aufnehmen (`apps/api/src/app.ts`, `apps/worker/src/index.ts`).

---

### Task 5: Messung und Flip dokumentieren

**Files:**
- Modify: `.env.example`, `docs/self-host.md`

**Interfaces:**
- Consumes: `RAKAZO_ACTION_FAIL_CLOSED`, `action_decisions`.
- Produces: nur Doku — keine neuen Exporte.

- [ ] **Step 1: Flag in `.env.example` aufnehmen**

Eintrag in der Nachbarschaft der anderen `RAKAZO_*`-Schalter ergaenzen (Bestandteil derselben Blocklogik wie `MCP_STDIO_ENABLED` bei `.env.example:157`):

```
# Record every action decision, and refuse a tool that no approval rule covers.
# Off by default: read action_decisions.wouldDeny first, then turn this on.
RAKAZO_ACTION_FAIL_CLOSED=false
```

- [ ] **Step 2: Auswertung in `docs/self-host.md` dokumentieren**

Ergaenze einen kurzen Abschnitt an der Stelle, die bereits Approval/Trust erklaert (Verweis `docs/self-host.md:343` ist der MCP-stdio-Block, danach ist der natuerliche Platz). Text exakt so:

```markdown
### Was ein Bot durfte

Jede Entscheidung über eine Werkzeugaktion landet in `action_decisions`. Die Tabelle ist per
Trigger append-only: eine Entscheidung nachträglich ändern oder löschen kann der Server nicht.

`wouldDeny` zeigt, was ein Fail-closed-Betrieb aufgehalten hätte, ohne dass etwas aufgehalten
wurde. Vor dem Umstieg also auszählen:

```sql
select tool_name, count(*) as silent_allows
from action_decisions
where would_deny
group by tool_name
order by silent_allows desc;
```

`RAKAZO_ACTION_FAIL_CLOSED=true` stellt den Default um: eine Werkzeugaktion, die keine
Approval-Regel deckt, fragt nach statt still durch zulassen. Bestehende `always_allow`-Regeln
gewinnen weiterhin. Der Wert gilt pro Deployment und ist pro Space über die bestehenden
Approval-Regeln verfeinerbar.
```

- [ ] **Step 3: Prüfen, dass nichts davon sichtbare neue Interface-Copy ist**

Run: `git diff --stat` und `grep -c "msgid" .env.example docs/self-host.md`
Expected: keine Aenderung unter `apps/web/src/locales/`; dieser Plan fuegt keine Lingui-Keys hinzu.

- [ ] **Step 4: Run checks and commit**

Run: `pnpm lint && pnpm check`
Expected: PASS.

```bash
git add .env.example docs/self-host.md
git commit -m "docs: explain how to measure before fail-closed enforcement"
```

---

## Self-Review

**Abdeckung der Ausgangslage:** fail-open-Default (Task 1), fehlender Entscheids-Nachweis (Task 2-4), Fail-closed-Semantik als Spec statt Code (Task 1 + Task 5), Dry-Run-Messung vor dem Flip (Task 3, Task 5), append-only wie bei openbot (Task 2).

**Platzhalter:** keine — jeder Code-Schritt enthaelt seinen Inhalt. Die zwei Stellen, an denen ein Ausfuehrender pruefen muss statt zu raten, sind bewusst als grep-Anweisung formuliert (Task 4 Step 3 fuer `deps.env`, Task 2 Step 5 fuer die Space-Fixture) und enthalten den Fallback.

**Typkonsistenz:** `ActionApprovalResolved`, `ActionApprovalSource`, `ActionGateOutcome`, `ActionDecisionRow` werden durchgaengig unter diesen Namen verwendet; `buildActionDecisionRow` liefert exakt das `data`-Objekt, das Task 2s Modell und Task 4s `create`-Aufruf erwarten; `deploymentActionFailClosed` heisst in Task 1, 4 und 5 identisch.

**Bewusst nicht getan:** keine Audit-Ansicht in der Oberflaeche, keine RPC, keine i18n-Keys, keine Retention-Policy. Erste Auswertung ist ein SQL-Statement fuer den Betreiber; eine Seite waere neues Interface ohne nachgewiesenen Bedarf.
