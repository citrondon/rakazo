# Web-E2E grün & Trust-Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die fünf verbleibenden roten Web-E2E-Tests auf `main` wieder grün bekommen und die Lücke schließen, die `reactive-trigger-hold` sichtbar macht (Wiederaufnahme eines Quiet-Hours-Runs).

**Architecture:** Rakazo ist ein Produkt über Web/Electron/Mobile; der Web-Client (`apps/web`) spricht `rpc` gegen `apps/api`, Orchestrierung und Autorität liegen im Backend (`packages/db` Run-State, `packages/adapters` Executor, `packages/core` Trust-Planung). Drei der fünf Failures sind Test-Erwartungen, die einer bewussten Produktänderung hinterherhinken (Copy, Sichtbarkeit widerrufener Konten, Owner-Race); eins ist ein echtes Wiring-Loch im Resume-Pfad; eins ist Doku-Drift.

**Tech Stack:** pnpm 9 Workspaces + Turborepo, TypeScript 7, React/Vite, Biome 2, Vitest 4, Playwright 1.63, Prisma 7 + PostgreSQL (Testcontainer im E2E-Harness), OrPC.

**Spec:** diese Datei; Belegquellen: `/tmp`-CI-Logs sind flüchtig — die Diagnosen stehen unten je Task mit Commit und `file:line`, und lassen sich mit den angegebenen Befehlen neu erzeugen.

## Global Constraints

- Immer auf Deutsch antworten (AGENTS.md).
- Öffentliches Repo: keine Secrets, `.env`, echten Kunden-/Produktionsdaten, privaten URLs in Commits, PR-Texten oder Kommentaren; auch keine lokalen Pfade, Benutzernamen, Hostnames, Tenant-/Issuer-IDs oder Account-Mails. Platzhalter benutzen, wenn ein Wert gezeigt werden muss.
- Kopie-Regel: jeder sichtbare Text ist UI. PR-Beschreibungen zu Copy-Änderungen zitieren die Copy, begründen sie und sagen, warum Weglassen/verspätetes Anzeigen nicht funktioniert.
- Farben nur aus `@rakazo/ui-tokens`; Web/Electron nutzen die vendoreden `packages/ui-web`-Komponenten; kein hartkodiertes Hex, kein `[var(--…)]`.
- `import type` auf Top-Level, nie inline; dynamisches `import()` nur für echtes Deferred Loading.
- Keine neuen Provider-/Model-spezifischen Env-Variablen, wenn die generische Connection das ausdrücken kann.
- Bevor ein Entscheidungs-Helfer (Router/Ranker/Triage, inkl. Modell-wählt-Modell) entsteht: Gate in `.agents/skills/decision-gate/SKILL.md` bestehen.
- Auth, Secrets, Sandbox-Grenzen, Host-Kommandos und Integrationen sind sicherheitskritisch — Änderungen dort brauchen Tests, die deterministisch und offline laufen.
- Die Desktop-Suite (`pnpm --filter @rakazo/desktop test:e2e`) öffnet echte Fenster und ist **nicht** als Routine-Verification gedacht; dieser Plan braucht sie nicht.
- Nach einem PR: `.agents/skills/pr-watch/SKILL.md` — `pr-digest --watch` als ein einziger Hintergrund-Call, kein Pollen im Vordergrund. Nicht mergen, solange Review-Bots offen sind.
- Merge nur nach ausdrücklicher Freigabe; bedingte Freigaben („falls grün") gelten nur bei erfüllter Bedingung.
- Vor jeder Verifikation: `git status --short` muss die eigene Arbeit zeigen, nicht die eines parallelen Laufs (Task 0).

## Verifikations-Befehle (gelten für alle Tasks)

```bash
# Eine Web-E2E-Datei gegen echten API+DB-Stapel (braust Docker für den Testcontainer-Postgres):
pnpm test:e2e -- --spec=e2e/<datei>.spec.ts
# Mehrere Dateien einer Gruppe:
pnpm test:e2e -- --spec="e2e/local-settings.spec.ts e2e/integration-setup.spec.ts"
# Ganze Web-Suite (so läuft CI; 165 pass / 5 fail war der Ausgangszustand):
pnpm test:e2e
# Web-Einheitstests / ein Testdatei:
pnpm --filter @rakazo/web test
pnpm exec vitest run packages/db/src/events.test.ts
# Gates:
pnpm lint
pnpm check
pnpm test
pnpm --filter @rakazo/web intl:check
```

Der Harness setzt `VITE_DEFAULT_UI_LOCALE=en`, die E2E-Selektoren matchen also die englischen `msgid`s aus `apps/web/src/locales/en/messages.po`. `playwright.config.ts:29-35` fährt einen Web-Server (`pnpm dev`), `packages/testkit/src/cli/harness.ts:228-247` startet API auf `:3110` und Web auf `:5180` mit frischer Postgres pro Lauf.

## File Structure

| Datei | Rolle | Aktion |
| --- | --- | --- |
| `apps/web/e2e/local-settings.spec.ts` | E2E für das Desktop-Settings-Fenster (gemockte Bridge) | Modify (Zeile 68) |
| `apps/web/e2e/integration-setup.spec.ts` | E2E „Server integrations" mit gemocktem RPC | Modify (Zeile 258) |
| `apps/web/e2e/golden.spec.ts` | E2E-Hauptpfad Plugins-Overlay, Multi-Account | Modify (Zeilen 193-197) |
| `apps/web/e2e/mcp-endpoint-gate.spec.ts` | E2E für das Private-Endpoint-Gate | Modify (Test 2, Zeilen 39-51) |
| `apps/web/e2e/reactive-trigger-hold.spec.ts` | E2E für Approval-Hold vor Destination-Write | Read, Modify nur nach Task-5-Entscheidung |
| `apps/web/src/components/integrations/IntegrationSetup.tsx` | Statuszeile einer Integration | Read (Zeilen 163-167, 268) |
| `apps/web/src/pages/PluginsOverlay.tsx` | Kontenliste, Remove, Uninstall | Read (Zeilen 605, 659-665, 704-713) |
| `apps/web/src/lib/connection-state.ts` | `connectionRowsFor` hält `revoked` sichtbar | Read (Zeilen 26-49) |
| `packages/db/src/events.ts` | Run-State-Übergänge inkl. `commitAnswerRunInput` | Modify (Zeilen 665-676) nach Task 5 |
| `packages/db/src/events.test.ts` | Unit-Tests der Übergänge | Modify (neuer Test) |
| `packages/adapters/src/executor.ts` | Approval-Pause `pauseRunForInput` | Read (Zeilen 2139-2154, 2397) |
| `HANDOFF.md` | §3 Schuldenliste | Modify (Korrektur) |
| `docs/KNOWN-ISSUES.md` | dokumentierte Gates | Read, optional Modify |

---

## Task 0: Arbeitsbaum isolieren (Vorbedingung für alles Weitere)

Der Klon hat 26 gemoddete Dateien und eine untracked `apps/web/src/components/PresetBoundaries.tsx`, die **nicht** von diesem Plan stammen (ein „boundaries"-Feature über `apps/api/src/router.ts`, `packages/contracts`, alle `messages.po`, `bot-library/*.json`). Solange sie im Baum liegen, ist jede Lint-/Check-/E2E-Aussage verunreinigt.

**Files:**
- keine Produktänderung

- [ ] **Step 1: Bestand aufnehmen**

```bash
cd <repo-root>
git status --short
git log --oneline -3
git diff --stat | tail -3
```

Expected: `main` auf `0bacfeb3` oder neuer, die 26 `M`-Einträge und `?? apps/web/src/components/PresetBoundaries.tsx`.

- [ ] **Step 2: Entscheiden lassen, nicht selbst entscheiden**

Den Betreiber fragen, ob dieser Stand (a) ein laufender eigener Auftrag ist → dann in einem separaten Branch sichern:

```bash
git switch -c wip/bot-preset-boundaries
git add -A && git commit -m "wip: preset boundaries (foreign session state)"
git switch main
```

oder (b) überflüssig ist → dann wegäumen statt löschen, damit nichts verloren geht:

```bash
git stash push -u -m "foreign preset-boundaries state"
git status --short   # Expected: leer
```

- [ ] **Step 3: Basis frisch halten**

```bash
git switch main && git pull --ff-only
```

Expected: Arbeitsbaum leer, `HEAD` = `origin/main`. Ab hier pro Task eigener Branch.

---

## Task 1: „Connected" → „Credentials saved" (Copy-Drift in zwei Specs)

Diagnose: Commit `b634daeb` („show connection status and reconnect in the integrations overlay") hat die Provider-Zeile bewusst von `<Trans>Connected</Trans>` auf `<Trans>Credentials saved</Trans>` umgestellt (`apps/web/src/components/integrations/IntegrationSetup.tsx:163-167`; Begründung im Commit: keine lebende Verbindung behaupten). Beide Specs asserten noch den alten Text und mocken den RPC vollständig — es ist reiner Erwartungs-Drift, kein Produktfehler. „Connected" bleibt als Button-Label für Direct MCP (`IntegrationSetup.tsx:268`) bestehen.

**Files:**
- Modify: `apps/web/e2e/local-settings.spec.ts:68`
- Modify: `apps/web/e2e/integration-setup.spec.ts:258`
- Test: dieselben Specs (Playwright)

**Interfaces:**
- Consumes: `IntegrationSetup.tsx` render `Credentials saved` bei konfigurierter Provider-Credential.
- Produces: nichts für andere Tasks.

- [ ] **Step 1: Erwartung lokal reproduzieren (Fail vor Fix)**

```bash
pnpm test:e2e -- --spec="e2e/local-settings.spec.ts e2e/integration-setup.spec.ts"
```

Expected: genau 2 Failures, `getByText('Connected', { exact: true })` → „element(s) not found" in `local-settings.spec.ts:68` und `integration-setup.spec.ts:258`.

- [ ] **Step 2: Spec an die neue Copy anpassen**

`apps/web/e2e/local-settings.spec.ts:68`:

```ts
  await expect(page.getByText("Credentials saved", { exact: true })).toBeVisible();
```

`apps/web/e2e/integration-setup.spec.ts:258`:

```ts
  await expect(page.getByText("Credentials saved", { exact: true })).toBeVisible();
```

- [ ] **Step 3: Spec-Runner erneut starten**

```bash
pnpm test:e2e -- --spec="e2e/local-settings.spec.ts e2e/integration-setup.spec.ts"
```

Expected: beide Tests grün (Übrige unverändert).

- [ ] **Step 4: Katalog-Konsistenz prüfen**

```bash
pnpm --filter @rakazo/web intl:check
```

Expected: exit 0. (`Credentials saved` existiert bereits als `msgid` in `apps/web/src/locales/en/messages.po:1724-1725`; Übersetzungen sind mit `6f284207` nachgezogen — keine Katalogänderung nötig.)

- [ ] **Step 5: Committen**

```bash
git switch -c fix/web-e2e-integration-copy
git add apps/web/e2e/local-settings.spec.ts apps/web/e2e/integration-setup.spec.ts
git commit -m "test(web): expect the saved-credential line in the integration e2e"
```

---

## Task 2: `golden.spec.ts` — Entfernen eines von zwei Konten

Diagnose: `b634daeb` hat die Liste im Detail-Panel von `activeAccounts` (nur `connected`/`pending`) auf `connectionRowsFor` umgestellt (`apps/web/src/pages/PluginsOverlay.tsx:605`), damit widerrufene Konten sichtbar bleiben (`apps/web/src/lib/connection-state.ts:26-49`, Unit-Test `connection-state.test.ts:37-49` „keeps a revoked account visible"). Der Backend-Revoke ist ein Soft-Delete (`apps/api/src/router.ts:4929-4937` setzt `status: "revoked"`; `:4361-4372` listet unverändert). Die Erwartung `toHaveCount(1)` stammt aus `25f09803` und ist damit überholt: nach „Remove" erscheinen weiterhin **zwei** Zeilen, eine davon als abgelaufen/wiederverbindbar.

**Files:**
- Modify: `apps/web/e2e/golden.spec.ts:193-197`
- Test: `apps/web/e2e/golden.spec.ts` (E2E), `apps/web/src/lib/connection-state.test.ts` (bestehend)

**Interfaces:**
- Consumes: `connectionRowsFor` hält `revoked`; UI-Text für diesen Zustand ist `OAuth expired` (`PluginsOverlay.tsx` im `state === "expired"`-Zweig), Button `Reconnect OAuth`.
- Produces: nichts für andere Tasks.

- [ ] **Step 1: Fail reproduzieren und Zustand ansehen**

```bash
pnpm test:e2e -- --spec=e2e/golden.spec.ts
```

Expected: 1 Failure `expected 1, received 2` bei `golden.spec.ts:194`. Danach den Playwright-Report öffnen und prüfen, was die zweite Zeile anzeigt:

```bash
pnpm exec playwright show-report playwright-report
```

- [ ] **Step 2: Erwartung auf die neue Semantik schreiben**

`apps/web/e2e/golden.spec.ts`, die drei Zeilen ab dem Remove-Klick ersetzen:

```ts
  await detailAgain.getByRole("button", { name: "Remove", exact: true }).last().click();
  // Revoked accounts stay listed on purpose (connectionRowsFor); the row is the evidence.
  await expect(detailAgain.getByLabel("Account label")).toHaveCount(2);
  await expect(detailAgain.getByText("OAuth expired", { exact: true })).toBeVisible();
  await expect(detailAgain.getByRole("button", { name: "Reconnect OAuth" })).toBeVisible();
  await detailAgain.getByRole("button", { name: "Uninstall", exact: true }).click();
  await expect(page.getByTestId("connection-detail")).toHaveCount(0);
```

- [ ] **Step 3: Prüfen, ob Uninstall wirklich aufräumt**

```bash
pnpm test:e2e -- --spec=e2e/golden.spec.ts
```

Expected: grün bis einschließlich Zeile „Gmail"-Zeile zeigt wieder `Add`. **Wenn** `Uninstall` die widerrufenen Zeilen nicht mit entfernt (Zeile 196/201 schlagen fehl), ist das kein Erwartungs-Drift mehr, sondern ein Produktfehler im Uninstall-Pfad — dann hier **stoppen**, Befund mit `file:line` melden und den Betreiber entscheiden lassen, statt die Assertion erneut zu biegen.

- [ ] **Step 4: Committen**

```bash
git switch -c fix/web-e2e-revoked-account-row
git add apps/web/e2e/golden.spec.ts
git commit -m "test(web): assert the revoked row stays visible after removing an account"
```

---

## Task 3: `mcp-endpoint-gate.spec.ts` — Owner-Race im E2E

Diagnose: Der Test „the owner can save a private endpoint without an env flag" verlässt sich darauf, dass sein Signup der Deployment-Owner ist (Kommentar in `mcp-endpoint-gate.spec.ts:4`: „The first user is the owner"). Owner wird aber first-come in `apps/api/src/router.ts:979-983` gesetzt (Schreiben von `deploymentSettings.ownerUserId`), und der Harness startet **pro Suite** eine frische DB — in der vollen Suite signen dutzende Specs vorher. Also ist der Nutzer nicht `isDeploymentOwner` (`packages/db/src/scope.ts:42`), `mayUsePrivateEndpoint` (`router.ts:483-485`) ist false, `assertSafeRemoteUrl` (`packages/adapters/src/remote-mcp.ts:160-162`) wirft „Connector URL must use HTTPS", das `create` antwortet 400 → `role="alert"` (`apps/web/src/pages/McpServersOverlay.tsx:346-353`) und die Liste bleibt ohne „Private LAN". Der Owner-Pfad ist bereits deterministisch auf API-Ebene abgedeckt: `apps/api/src/router.test.ts:538` „lets the deployment owner save a loopback endpoint".

**Files:**
- Modify: `apps/web/e2e/mcp-endpoint-gate.spec.ts:39-51`
- Test: `apps/api/src/router.test.ts` (bestehend, Referenz für die Abdeckung)

**Interfaces:**
- Consumes: Nichts.
- Produces: Nichts.

- [ ] **Step 1: Race beweisen (vorher/nachher im selben Lauf)**

```bash
# allein auf frischer DB: wird durchgehen (der Signup ist der erste Nutzer)
pnpm test:e2e -- --spec=e2e/mcp-endpoint-gate.spec.ts
# im Verband der vollen Suite: schlägt fehl
pnpm test:e2e -- --grep="private endpoint"
```

Expected: einzeln grün, und im vollen Lauf rot — das ist der Beleg, dass die Reihenfolge und nicht das Produkt entscheidet. **Ergebnis kurz notieren**, es gehört in die PR-Beschreibung.

- [ ] **Step 2: Betreiber-Entscheidung einholen (Pflicht, kein Auto-Fix)**

Zwei Möglichkeiten, die sich in der Absicht unterscheiden:
- **(A) empfohlen:** Der E2E prüft nur, was ein E2E deterministisch kann — das Nicht-Owner-Verhalten (Ablehnung mit kurzer Ursache) — und der Owner-Pfad bleibt in `router.test.ts:538`, wo er ohne Race läuft. Der verlorene Fall ist kein verlorener Schutz, sondern nur die doppelte Abdeckung eines Gates.
- **(B)** Der Harness bekommt einen Seed für `deploymentSettings.ownerUserId` (z. B. feste E2E-Mail), damit der E2E deterministisch Owner wird. Kostet neuen Test-Pfad im Harness und eine feste Identität in einem öffentlichen Repo — Werte nur als Platzhalter dokumentieren.

- [ ] **Step 3 (nur bei (A)): Test umschreiben**

`apps/web/e2e/mcp-endpoint-gate.spec.ts:39-51` ersetzen durch:

```ts
test("a non-owner cannot save a private endpoint", async ({ page }, testInfo) => {
  await signup(page, `mcp-gate-private-${Date.now()}@rakazo.test`, "password12", "MCP Private");
  await completeOnboarding(page);
  await openMcpServers(page);

  // Ownership is claimed first-come per deployment, so a suite-wide run cannot assume it.
  // The owner escape is covered without a race in apps/api/src/router.test.ts.
  await addServer(page, "Private LAN", "http://10.0.0.8:3927/mcp");

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/must use HTTPS|MCP_ALLOW_PRIVATE_ENDPOINT=true/);
  await expect(page.getByText("Private LAN", { exact: true })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "mcp-endpoint-gate-private-refused");
});
```

- [ ] **Step 4: In der Suite-Reihenfolge prüfen, nicht einzeln**

```bash
pnpm test:e2e -- --spec="e2e/local-settings.spec.ts e2e/mcp-endpoint-gate.spec.ts"
```

Expected: grün, unabhängig davon, welche Spec zuerst signed.

- [ ] **Step 5: Committen**

```bash
git add apps/web/e2e/mcp-endpoint-gate.spec.ts
git commit -m "test(web): stop assuming deployment ownership in the MCP endpoint e2e"
```

---

## Task 4: Quiet-Hours-Wiring — Diagnose vor Tat

Diagnose: `67a7cc25` hat in `apps/web/e2e/reactive-trigger-hold.spec.ts:120` die Erwartung `waiting_input` **neu eingeführt** (vorher `toBeNull()`) und den Prompt auf „write this to the destination crm as a note" umgestellt, ohne eine Wiederaufnahme-Pfad-Änderung — d. h. die Erwartung ist der Verdrahtung voraus. Beide Halte-Punkte existieren: Weck-Hold `holdRunForChoice` (`packages/db/src/events.ts:879-888`, gerufen aus `apps/api/src/webhook-inbound.ts:289`, verdrahtet über `apps/api/src/trigger-trust.ts:21` → `packages/core/src/trust-runner.ts:79` → `planQuietHours` in `packages/core/src/trust-effects.ts:141`, Einsatz in `apps/api/src/app.ts:583-601`) und Approval-Hold `pauseRunForInput` (`packages/adapters/src/executor.ts:2397`, Gate `toolRequiresApproval` in `packages/core/src/action-approval.ts:92-102`). Was fehlt: `commitAnswerRunInput` (`packages/db/src/events.ts:665-676`) setzt den Run auf `queued`, räumt aber `trustPhase: "paused"` und `resumeAt` nicht — das tut nur `autoResumeQuietHoursRun` (`events.ts:960-967`). `planTrustPhases` (`packages/core/src/trust-runner.ts:41`) hat **null** Produktions-Aufrufe (nur `trust-runner.test.ts:48-77`, `packages/testkit/src/trust-journeys`-artige Conformance-Tests). Kein Provider nötig: `harness.ts:17-20,62-64` fährt Fake-Sandbox + Scripted-Runtime + Emulator.

**Files:**
- Read: `apps/web/e2e/reactive-trigger-hold.spec.ts:88-130`, `packages/db/src/events.ts:640-700`, `packages/adapters/src/executor.ts:2130-2160`
- Modify: noch keine — dieser Task endet mit einer Entscheidungsvorlage

**Interfaces:**
- Consumes: Run-Feld `trustPhase`, `resumeAt`, `status`.
- Produziert: eine begründete Empfehlung für Task 5 mit exakten `file:line`.

- [ ] **Step 1: Fail isoliert reproduzieren**

```bash
pnpm test:e2e -- --spec=e2e/reactive-trigger-hold.spec.ts
```

Expected: Failure in Zeile 120, `Received: null`.

- [ ] **Step 2: Run-Zustand nach der Antwort ablesen**

Im Spec-Runner die Spalte des laufenden Runs ansehen, nachdem die Antwort committet wurde. `heldRunStatus` liest `threads/get` → `run.status`; zusätzlich den Rohzustand über die DevTools-Netzwerkantwort oder einen einmaligen Log ziehen:

```bash
pnpm exec vitest run packages/db/src/events.test.ts -t "answer"
```

Expected: die bestehenden Tests bleiben grün — sie decken `commitAnswerRunInput` nur für `status`, nicht für `trustPhase`/`resumeAt` ab. Genau diese Lücke ist der Kandidat.

- [ ] **Step 3: Entscheidungsvorlage schreiben (an den Betreiber, nicht ins Repo)**

Drei Zeilen: (1) Welchen Zustand hat `run` direkt nach der Antwort (`status`, `trustPhase`, `resumeAt`)? (2) Erreicht der Run danach den Executor überhaupt (`packages/adapters/src/executor.ts:2397`)? (3) Welche der beiden Bedeutungen soll `waiting_input` nach Wiederaufnahme haben — „erneute Approval-Pause vor dem Write" (dann ist der Resume-Pfad zu fixieren) oder „einmal gehalten, danach durch" (dann ist die Spec-Erwartung aus `67a7cc25` zu korrigieren)? Ohne Antwort ist Task 5 blockiert.

---

## Task 5: Resume-Pfad fixen **oder** Erwartung korrigieren (nach Task 4)

Dieser Task wird erst nach der Freigabe aus Task 4 ausgeführt. Beide Zweige sind vollständig ausformuliert.

### Zweig A — Produkt: Wiederaufnahme räumt Quiet-Hours-Rest

**Files:**
- Modify: `packages/db/src/events.ts:665-676` (`commitAnswerRunInput`)
- Test: `packages/db/src/events.test.ts` (neben `:569`, `:647`, `:935`)
- Verify: `apps/web/e2e/reactive-trigger-hold.spec.ts:120`

**Interfaces:**
- Consumes: vorhandener Run mit `trustPhase: "paused"`, `resumeAt: Date`, `status`.
- Produces: `commitAnswerRunInput(...)` liefert `status: "queued"` **und** `trustPhase: null`, `resumeAt: null`; Executor kann den Approval-Hold erneut erreichen.

- [ ] **Step 1: Fehlenden Unit-Test schreiben**

In `packages/db/src/events.test.ts` ergänzen (Muster an die benachbarten Tests in `:569`/`:647` anlehnen):

```ts
  it("clears the quiet-hours hold when an answer is committed", async () => {
    const run = await createRunFixture({ status: "waiting_input", trustPhase: "paused" });
    await commitAnswerRunInput(run.id, { answer: "ok" });
    const after = await loadRun(run.id);
    expect(after.status).toBe("queued");
    expect(after.trustPhase).toBeNull();
    expect(after.resumeAt).toBeNull();
  });
```

- [ ] **Step 2: Fail sehen**

```bash
pnpm exec vitest run packages/db/src/events.test.ts
```

Expected: neue Spec fällt mit `trustPhase: "paused"` statt `null`.

- [ ] **Step 3: Minimal implementieren**

In `commitAnswerRunInput` (`packages/db/src/events.ts:665-676`) das Update um die beiden Felder erweitern — exakt dieselbe Räum-Logik, die `autoResumeQuietHoursRun` (`events.ts:960-967`) bereits verwendet, damit es eine Quelle der Wahrheit bleibt:

```ts
      data: {
        status: "queued",
        trustPhase: null,
        resumeAt: null,
      },
```

- [ ] **Step 4: Unit + E2E**

```bash
pnpm exec vitest run packages/db/src/events.test.ts
pnpm test:e2e -- --spec=e2e/reactive-trigger-hold.spec.ts
```

Expected: Unit grün; E2E Zeile 120 wird `waiting_input`. Falls das E2E weiterhin `null` liefert, liegt der Bruch nicht am Räumen, sondern davor (Job wird nicht neu eingeplant — `apps/api/src/router.ts:2402-2416` ansehen) und der Task bleibt offen; **nicht** die Erwartung anpassen.

- [ ] **Step 5: Committen**

```bash
git add packages/db/src/events.ts packages/db/src/events.test.ts
git commit -m "fix(db): clear the quiet-hours hold when an answer resumes a run"
```

### Zweig B — Test: einmal halten, dann durch

**Files:**
- Modify: `apps/web/e2e/reactive-trigger-hold.spec.ts:118-121`

- [ ] **Step 1: Erwartung auf den freigegebenen Zustand setzen**

```ts
  // Resuming releases the quiet-hours hold; the write proceeds without a second pause.
  await expect.poll(() => heldRunStatus(page, botId), { timeout: 30_000 }).toBeNull();
```

- [ ] **Step 2: Verifizieren**

```bash
pnpm test:e2e -- --spec=e2e/reactive-trigger-hold.spec.ts
```

Expected: grün. Die nachfolgenden Zeilen des Specs (Approval-Vorschau vor dem Write) müssen **ebenfalls** grün bleiben — fallen sie weg, war die Erwartung aus `67a7cc25` gewollt und Zweig A ist richtig.

- [ ] **Step 3: Committen**

```bash
git add apps/web/e2e/reactive-trigger-hold.spec.ts
git commit -m "test(web): assert the released hold instead of a second pause"
```

---

## Task 6: Doku-Schulden berichtigen

Diagnose: `HANDOFF.md:86-91` behauptet, `planTrustPhases` **und** `planQuietHours` seien getestet aber nicht verdrahtet. Nachgemessen: `planQuietHours` ist verdrahtet (`apps/api/src/trigger-trust.ts:21` → `packages/core/src/trust-runner.ts:79`, Einsatz `apps/api/src/app.ts:583-601`); nur `planTrustPhases` (`packages/core/src/trust-runner.ts:41`) hat keinen Produktions-Aufruf.

**Files:**
- Modify: `HANDOFF.md` §3

- [ ] **Step 1: Behauptung durch Fakt ersetzen**

Im betroffenen Absatz `HANDOFF.md` den Verweis auf `planQuietHours` streichen und präzise lassen: Phasen-Maschine `planTrustPhases` geplant, getestet, nicht verdrahtet; Quiet-Hours-Planung läuft über `planRunTrust`.

- [ ] **Step 2: Konsistenz mit Task 5 abgleichen**

Falls Task 5 Zweig A lief: ein Satz, was das Räumen von `trustPhase`/`resumeAt` jetzt abdeckt und was an der Phasen-Maschine offen bleibt.

- [ ] **Step 3: Committen**

```bash
git add HANDOFF.md
git commit -m "docs: correct the trust wiring status in the handoff notes"
```

---

## Task 7: Gesamtverifikation und PR

- [ ] **Step 1: Alle Gates lokal**

```bash
pnpm lint && pnpm check && pnpm test && pnpm --filter @rakazo/web intl:check
```

Expected: alle exit 0. (`pnpm lint` kann Edit-Stände anderer Worktrees sehen — `.kilo/worktrees/` ist im Repo; bei Findings in fremden Pfad prüfen, bevor etwas „behoben" wird.)

- [ ] **Step 2: Ganze Web-Suite wie CI**

```bash
pnpm test:e2e
```

Expected: **170 passed**, 0 failed (Ausgangszustand: 165 passed / 5 failed).

- [ ] **Step 3: PR**

```bash
git push -u origin <branch>
PATH="$HOME/.local/bin:$PATH" gh pr create --base main --head <branch>
```

Beschreibung: Why (welche Erwartung hinkte welcher bewussten Änderung hinterher bzw. welche Verdrahtung fehlte), What, How tested (exakt die Befehle aus Step 1-2 mit Zahlen). Bei Copy-Berührung die betroffenen Zeilen zitieren. Keine lokalen Pfade, keine Account-Mails, keine Rechner-/Tenant-Kennungen.

- [ ] **Step 4: PR begleiten**

`pr-digest --watch` als einziger blockierender Hintergrund-Call, Verdikt abwarten, Findings beantworten, Merge nur nach Freigabe. Vorher prüfen, dass `Web E2E` auf dem Head grün ist — das ist genau der Job, um den es hier geht.

## Self-Review

Abdeckung: die fünf CI-Failures sind je einer Aufgabe zugeordnet (`local-settings:68` + `integration-setup:258` → Task 1; `golden:194` → Task 2; `mcp-endpoint-gate:48` → Task 3; `reactive-trigger-hold:120` → Task 4/5); Doku-Drift → Task 6; Verifikation → Task 7. Platzhalter: keine — jede Code-Änderung steht als Block da, offene Punkte sind explizit Entscheidungspunkte mit begründeten Optionen (Task 0 Step 2, Task 2 Step 3, Task 3 Step 2, Task 4 Step 3). Typ-Konsistenz: `connectionRowsFor`, `commitAnswerRunInput`, `autoResumeQuietHoursRun`, `pauseRunForInput`, `toolRequiresApproval`, `mayUsePrivateEndpoint`, `heldRunStatus` wurden gegen die aktuellen Dateien geprüft; die Felder `trustPhase`/`resumeAt` stammen aus `packages/db/src/events.ts:960-967`.
