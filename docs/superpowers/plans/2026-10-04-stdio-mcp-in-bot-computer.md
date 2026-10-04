# stdio-MCP im Bot-Computer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein stdio-MCP-Server wird als Prozess im Computer des Bots ausgeführt statt im API-/Worker-Prozess, und ein Deployment schaltet das pro Flag um.

**Architecture:** Der langlebige Teil des Kanals ist die **Antwort**, nicht die Anfrage: `POST /computers/:id/processes` startet den Prozess und liefert eine processId, `GET .../events` streamt stdout/stderr/exit als NDJSON (dasselbe Muster, das `/exec` schon produktiv fährt), `POST .../stdin` liefert einzelne JSON-RPC-Frames als Body **mit** `Content-Length`, und `DELETE .../processes/:pid` beendet. stdio-MCP-Server sterben an geschlossener stdin, deshalb ist kein Lease-Zustand nötig: die Prozess-Tabelle lebt nur im Supervisor-Prozess. Darüber liegt eine `Transport`-Implementierung des MCP-SDK, und der `McpConnector` wählt Host- oder Sandbox-Pfad pro Flag.

**Tech Stack:** TypeScript, Hono 4.13.7 (`@hono/node-server`), dockerode 5.0.1, `@modelcontextprotocol/sdk` 1.30, Vitest, Biome, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-04-stdio-mcp-in-bot-computer-design.md` — Executors lesen beide Dokumente; der Plan argumentiert aus der Spec, nicht umgekehrt.

## Ausgangslage (Belege, Stand `68c4ad03`)

- `packages/adapters/src/mcp-transport.ts:381-399` spawnt via `StdioClientTransport` im eigenen Prozess; die Prozessumgebung kennt `DATABASE_URL` (infra/compose/docker-compose.yml:69,106) und mountet `/data` (:93-95).
- Der alte Plan dieses Features wollte stdin als Request-Body eines langlebigen POST streamen. Das ist unmöglich: `infra/sandboxes/supervisor/src/index.ts:110-125,157-158` stellt `hono/bodyLimit` vor `/computers` und `/computers/*`, und dessen Implementierung (node_modules/.pnpm/hono@4.13.7/node_modules/hono/dist/middleware/body-limit/index.js) liest einen Body **ohne** `Content-Length` vollständig und rekonstruiert ihn als geschlossenen Stream, bevor `next()` läuft; zusätzlich greift `MAX_SUPERVISOR_REQUEST_BYTES = 1024 * 1024`. Dieselbe Quelle rettet den neuen Entwurf: `if (!c.req.raw.body) return next()` (ein GET ohne Body passiert unberührt) und ein POST **mit** `Content-Length` wird nur an der Größe gemessen, nicht gelesen.
- Response-Seitig existiert das benötigte Muster bereits: `/exec` baut einen `ReadableStream` und liefert `application/x-ndjson; charset=utf-8` mit `x-accel-buffering: no` (infra/sandboxes/supervisor/src/index.ts:339-432); die Client-Seite liest ihn in `packages/adapters/src/docker-sandbox.ts:201-209` über `readNdjsonProcessEvents` (:573).
- dockerode-Duplex existiert: `container.exec({AttachStdin})` + `exec.start({hijack: true, stdin})` + `createDockerStreamDemuxer()` (infra/sandboxes/supervisor/src/index.ts:1549-1603, supervisor-logic.ts:463).
- Mandantensicherung pro Computer ist vorhanden: `managedContainer(id, botId, spaceId)` (index.ts:1095-1102) wirft `ComputerIdentityError` bei Identitäts-Abgleich-Fehler; die Header liefert `DockerSandboxProvider.headers(context, botId)` (docker-sandbox.ts:132).
- Der Bot-Computer hat **kein** node/npm (infra/sandboxes/computer/Dockerfile:30-73: python3, uv/uvx, gh, curl, git), obwohl `computer-spec.ts:296` längst `NPM_CONFIG_PREFIX=/home/rakazo/.local` setzt.
- Die Session-Schlüssel des `McpConnector` sind für stdio bereits auf `botId` runtergekeyt (mcp-connector.ts:314-320) — genau das Muster, das die Spec für Prozess-Handles verlangt.

## Global Constraints

- Kein Hosted-Vendor im Kernpfad; alles bleibt selbst-hostbar (AGENTS.md).
- Neues Verhalten hinter eigenem Flag `RAKAZO_MCP_STDIO_IN_SANDBOX`, **aus**; aus bedeutet: exakt der heutige Host-Pfad, kein einziger Codepfad wird anders ausgeführt.
- Containment gilt für Netzwerk und Credentials, **nicht** für das Dateisystem: `data/homes/<botId>` ist in beide Container gemountet (packages/adapters/src/home.ts:32-41, supervisor index.ts:1172-1177). Jede Doku-Aussage, die Datei-Isolation behauptet, ist ein Finding.
- Kein WebSocket, kein Lease, kein persistierter Prozess-Zustand. Die prozessflüchtige Handle-Tabelle ist absichtlich; ein Supervisor-Neustart darf nichts rekonstruieren müssen.
- stdout-Frames werden **nie** verworfen: Queue-Überlauf beendet den Prozess sichtbar. stderr darf verworfen werden, aber nur mit explizitem `truncated`-Flag.
- Genau ein Schreiber pro Prozess (Session-Queue im Transport), ein Prozess pro (Bot, Server).
- `{home}` expandiert im Sandbox-Pfad nach `/home/rakazo`; ein Argument, das mit dem Host-`DATA_DIR`-Präfix beginnt, wird **abgelehnt**, nicht übersetzt.
- `import type` auf Top-Level-Ebene, nie inline.
- Tests deterministisch und offline; echte Container-Läufe nur gated (`VERIFY_DATABASE=1` plus Docker-Präsenz, Muster: packages/testkit/src/app-image-corepack.test.ts).
- Verifikation pro Task: `pnpm --filter @rakazo/adapters test`, `pnpm --filter @rakazo/sandbox-supervisor test` (Package-Name prüfen: `grep -n '"name"' infra/sandboxes/supervisor/package.json`), `pnpm check`, `pnpm lint`.
- Der Arbeitsbaum enthält parallele Edits eines anderen Prozesses (`apps/api/src/router.ts`, `packages/contracts/src/domain.ts`, `apps/web/src/pages/mcp-presets.ts`, `bot-library/*`, `apps/web/src/locales/*`). **Nur** die im Plan genannten Pfade stagen, niemals `git add -A`. `apps/web/src/pages/mcp-presets.ts` wird in diesem Plan **nicht** angefasst.
- Kein neuer sichtbarer Text und kein neuer i18n-Key; zusätzliche Prosa ausschließlich in `docs/` und `.env.example`.

---

## File Structure

| Datei | Verantwortung |
| --- | --- |
| `infra/sandboxes/computer/Dockerfile` (modifizieren) | Node LTS pinned + sha256, nach uv/gh-Muster |
| `infra/sandboxes/supervisor/src/computer-spec.test.ts` (modifizieren) | Nachweis, dass das Image Node ausweist |
| `packages/adapter-kit/src/types.ts` (modifizieren) | `SandboxProcess`, `SandboxProcessRequest` |
| `packages/adapter-kit/src/interfaces.ts` (modifizieren) | `SandboxProvider.openProcess?` |
| `infra/sandboxes/supervisor/src/supervisor-logic.ts` (modifizieren) | `sandboxProcessWrapper`, `sandboxProcessKillCommand`, reine Logik ohne docker |
| `infra/sandboxes/supervisor/src/supervisor-logic.test.ts` (modifizieren) | Wrapper- und Kill-argv |
| `infra/sandboxes/supervisor/src/container-process.ts` (neu) | `startContainerProcess(container, argv, opts)` — dockerode-Duplex-Handle |
| `infra/sandboxes/supervisor/src/container-process.test.ts` (neu) | Handle gegen Fake-Container: demux, exit, kill, stdin |
| `infra/sandboxes/supervisor/src/process-registry.ts` (neu) | Handle-Tabelle, Reservierung vor dem Start, identitätsgebundenes Release, Idle-TTL |
| `infra/sandboxes/supervisor/src/process-registry.test.ts` (neu) | Race „Reader weg vor Start", Verdrängung, TTL |
| `infra/sandboxes/supervisor/src/index.ts` (modifizieren) | Routes `POST/GET/DELETE /computers/:id/processes[/:pid…]` |
| `infra/sandboxes/supervisor/src/process-routes.test.ts` (neu) | Routen gegen Fake-Registry, Middleware-Prämisse |
| `packages/adapters/src/docker-sandbox.ts` (modifizieren) | `openProcess` als HTTP-Client über den Kanal |
| `packages/adapters/src/docker-sandbox-process.test.ts` (neu) | Client-Framing, 409, Abort |
| `packages/adapters/src/host-aware-sandbox.ts` (modifizieren) | `openProcess` durch den Delegations-Wrapper durchreichen |
| `packages/adapters/src/sandbox-conformance.test.ts` (modifizieren) | `openProcess` im Conformance-Set |
| `packages/adapters/src/sandbox-stdio-transport.ts` (neu) | MCP `Transport` über `SandboxProcess` |
| `packages/adapters/src/sandbox-process-fake.ts` (neu) | ein steuerbarer Fake-Handle, von Task 6 und Task 7 gemeinsam benutzt |
| `packages/adapters/src/sandbox-stdio-transport.test.ts` (neu) | Framing, Serialisierung, Queue-Überlauf, stderr-Truncation |
| `packages/adapters/src/mcp-transport.ts` (modifizieren) | `sandboxStdioArgv`, `McpSession.connectSandboxStdio` |
| `packages/adapters/src/mcp-connector.ts` (modifizieren) | Pfadwahl, Prozess-Reuse pro (Bot, Server), Idle-TTL |
| `packages/core/src/mcp-stdio.ts` (neu) | `deploymentMcpStdioInSandbox(env)` nach dem Flag-Muster |
| `apps/api/src/app.ts`, `apps/worker/src/index.ts` (modifizieren) | Composition: `openStdioProcess` injizieren |
| `apps/api/src/env.ts` (modifizieren) | `mcpStdioInSandbox` aus `RAKAZO_MCP_STDIO_IN_SANDBOX` |
| `docs/self-host.md`, `.env.example` (modifizieren) | Flag, Containment-Grenze, Kosten |

---

### Task 1: Node LTS in das Computer-Image

**Files:**
- Modify: `infra/sandboxes/computer/Dockerfile` (nach dem uv-Block, aktuell :60-73)
- Test: `infra/sandboxes/supervisor/src/computer-spec.test.ts` (Dockerfile wird dort schon gelesen: :198, :233)

**Interfaces:**
- Consumes: nichts.
- Produces: ein Computer-Image, in dem `node`, `npm`, `npx` auf dem PATH erreichbar sind; damit funktioniert `npx -y pkg@pin` (apps/web/src/pages/mcp-presets.ts:45-46) im Container.

- [ ] **Step 1: failing test**

In `infra/sandboxes/supervisor/src/computer-spec.test.ts` einen Block ergänzen, der — exakt wie die bestehenden Fälle bei :198 und :233 — das Dockerfile liest und die Pinning-Invarianten prüft:

```ts
  it("ships a pinned node with a checksum, like uv and gh", () => {
    const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/ARG NODE_VERSION=\d+\.\d+\.\d+/);
    expect(dockerfile).toMatch(/node_v\$?\{NODE_VERSION\}_linux-(x64|arm64)\.tar\.xz/);
    // Beide Architekturen müssen eine eigene sha256 haben — ein Fall ohne Prüfung ist
    // kein Pin, sondern ein Download ins Blaue.
    const archCases = dockerfile.match(/amd64|arm64/g) ?? [];
    const shaLines = dockerfile.match(/node_sha256=[0-9a-f]{64}/g) ?? [];
    expect(archCases.length).toBeGreaterThanOrEqual(2);
    expect(shaLines).toHaveLength(2);
    expect(dockerfile).toMatch(/node --version/);
    expect(dockerfile).toMatch(/npx --version/);
  });
```

Prüfen, welches `root` die bestehenden Fälle verwenden (`sed -n '190,200p' infra/sandboxes/supervisor/src/computer-spec.test.ts`), und denselben Wert nutzen — nicht raten.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rakazo/sandbox-supervisor test computer-spec`
Expected: FAIL, weil das Dockerfile kein `ARG NODE_VERSION` enthält. Package-Name vorher verifizieren: `grep -n '"name"' infra/sandboxes/supervisor/package.json`.

- [ ] **Step 3: Dockerfile-Block ergänzen**

Analog zum uv-Block (:60-73) — `TARGETARCH`-case, explizite sha256 je Architektur, `sha256sum -c -`, entpacken nach `/usr/local`, Selbstauskunft am Ende. Node-LTS-Tarballs heißen `node-v<VERSION>-linux-x64.tar.xz` bzw. `-linux-arm64.tar.xz` und enthalten `bin/node`, `bin/npm`, `bin/npx`:

```dockerfile
# stdio-MCP-Presets starten mit npx; bookworm-slim bringt kein Node mit.
# Pinned und checksummiert wie uv und gh.
ARG NODE_VERSION=22.20.0
RUN set -eux; \
  case "$TARGETARCH" in \
    amd64) node_arch=x64; node_sha256=<sha256-der-x64-tarball-datei> ;; \
    arm64) node_arch=arm64; node_sha256=<sha256-der-arm64-tarball-datei> ;; \
    *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
  esac; \
  archive="$(mktemp)"; \
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -o "$archive"; \
  echo "$node_sha256  $archive" | sha256sum -c -; \
  tar -xJf "$archive" -C /usr/local --strip-components=1 \
    "node-v${NODE_VERSION}-linux-${node_arch}/bin" \
    "node-v${NODE_VERSION}-linux-${node_arch}/lib" \
    "node-v${NODE_VERSION}-linux-${node_arch}/include"; \
  rm -f "$archive"; \
  node --version; \
  npm --version; \
  npx --version
```

Die Platzhalter **nicht** stehen lassen: beide sha256-Werte von `https://nodejs.org/dist/v22.20.0/SHASUMS256.txt` holen (einmal nachschauen, einmal schreiben), und die Version mit der dort tatsächlich gelisteten LTS abgleichen. Ist `22.20.0` dort nicht gelistet, die nächstkleinerte gelistete 22.x nehmen und den Test entsprechend anpassen — die Pinning-Struktur ist die Anforderung, nicht die Zahl.

- [ ] **Step 4: Image bauen und Nachlauf im Container beweisen**

Run: `docker build -t rakazo-computer-node-test infra/sandboxes/computer && docker run --rm rakazo-computer-node-test sh -lc 'node -v && npx -v && echo "$PATH"'`
Expected: zwei Versionszeilen; `PATH` enthält `/usr/local/bin` (bestehend, computer-spec.ts:295). Kein Push, kein Tag auf einem Registry — lokales Label, danach `docker rmi`.

- [ ] **Step 5: Run tests, lint, typecheck**

Run: `pnpm --filter @rakazo/sandbox-supervisor test && pnpm lint && pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/sandboxes/computer/Dockerfile infra/sandboxes/supervisor/src/computer-spec.test.ts
git commit -m "feat(computer): ship a pinned node runtime so stdio presets can run in the sandbox"
```

---

### Task 2: Prozessvertrag in der Adapter-Schicht

**Files:**
- Modify: `packages/adapter-kit/src/types.ts` (nach `CommandRequest`/`ProcessEvent`, :84-97)
- Modify: `packages/adapter-kit/src/interfaces.ts` (`SandboxProvider`, :83-107)
- Test: `packages/adapters/src/sandbox-conformance.test.ts` (modifizieren, Schritt 4)

**Interfaces:**
- Consumes: bestehend `CommandRequest` (`argv`, `cwd?`, `env?`), `ProcessEvent` (`stdout|stderr|exit`), `ComputerRef`, `AdapterContext`.
- Produces:
  ```ts
  export interface SandboxProcess {
    readonly id: string;
    /** Ein JSON-RPC-Frame inkl. newline. Liefert auf, wenn der Supervisor den Frame übernommen hat. */
    write(line: string): Promise<void>;
    /** stdout/stderr/exit in Reihenfolge; endet mit exit. Darf nur einmal iteriert werden. */
    events(): AsyncIterable<ProcessEvent>;
    kill(): Promise<void>;
  }
  ```
  und auf `SandboxProvider`:
  ```ts
    /** Langlebiger Vollduplex-Prozess im Computer; stdin über write(), Ausgabe über events(). */
    openProcess?(
      computer: ComputerRef,
      request: CommandRequest,
      context: AdapterContext,
    ): Promise<SandboxProcess>;
  ```

Optional, damit Provider ohne Duplex-Fähigkeit (Desktop, Mocks) unverändert kompilieren. `events()` nutzt bewusst das bestehende `ProcessEvent` — kein zweiter Ereignistyp.

- [ ] **Step 1: failing typecheck**

`packages/adapter-kit/src/types.ts` und `interfaces.ts` erst **nicht** anfassen; stattdessen in `packages/adapters/src/sandbox-conformance.test.ts` einen Fall anlegen, der den Typ benutzt:

```ts
  it("requires a declared process channel to satisfy the same event contract as execute", async () => {
    const provider: SandboxProvider = desktop;
    if (!provider.openProcess) throw new Error("provider must expose openProcess to pass conformance");
    const processHandle = await provider.openProcess(computer, { argv: ["node", "-e", "0"] }, ctx);
    const seen: ProcessEvent[] = [];
    for await (const event of processHandle.events()) seen.push(event);
    expect(seen.at(-1)).toEqual({ type: "exit", code: 0 });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @rakazo/adapters test sandbox-conformance`
Expected: FAIL — `openProcess` existiert nicht auf `SandboxProvider` (TS) bzw. die Zeile wirft den Error.

- [ ] **Step 3: Vertrag definieren**

Beide Blöcke aus dem Interfaces-Abschnitt einfügen: `SandboxProcess` in `types.ts` direkt nach `ProcessEvent` (:93-97), `openProcess?` in `interfaces.ts` direkt nach `execute(...)` (:103-107). `packages/adapter-kit/src/index.ts` exportiert die Typen bereits über `export * from "./types.js"` — verifizieren mit `grep -n 'types.js\|interfaces.js' packages/adapter-kit/src/index.ts` und nur ergänzen, wenn fehlt.

- [ ] **Step 4: Fake-Provider im Conformance-Harness nachziehen**

Der Harness-Provider in `packages/adapters/src/sandbox-conformance.test.ts` (Header :1-40 ansehen, dort wird `desktop` erzeugt) bekommt eine `openProcess`-Implementierung gegen einen Fake, damit der Test aus Schritt 1 grün wird:

```ts
    openProcess: async (_computer, request) => ({
      id: `proc-${request.argv.join("-")}`,
      write: async () => {},
      events: async function* () {
        yield { type: "stdout", data: "ready\n" } as ProcessEvent;
        yield { type: "exit", code: 0 } as ProcessEvent;
      },
      kill: async () => {},
    }),
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @rakazo/adapters test && pnpm --filter @rakazo/adapter-kit test && pnpm check`
Expected: PASS. Bestehende Provider ohne `openProcess` bleiben gültig (optionales Member).

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-kit/src/types.ts packages/adapter-kit/src/interfaces.ts packages/adapter-kit/src/index.ts packages/adapters/src/sandbox-conformance.test.ts
git commit -m "feat(adapter-kit): describe a duplex process channel for sandboxed stdio"
```

---

### Task 3: `startContainerProcess` — dockerode-Duplex als Handle

**Files:**
- Create: `infra/sandboxes/supervisor/src/container-process.ts`
- Test: `infra/sandboxes/supervisor/src/container-process.test.ts`
- Modify: `infra/sandboxes/supervisor/src/supervisor-logic.ts` (zwei reine Helper)
- Test: `infra/sandboxes/supervisor/src/supervisor-logic.test.ts`

**Interfaces:**
- Consumes: `createDockerStreamDemuxer()` (supervisor-logic.ts:463), dockerode `Docker.Container`.
- Produces:
  ```ts
  export interface ContainerProcessHandle {
    write(line: string): Promise<void>;
    onOutput(listener: (chunk: { stream: "stdout" | "stderr"; data: string }) => void): void;
    kill(): Promise<void>;
    /** Löst auf, wenn der Kindprozess beendet ist; code ist der Exit-Code. */
    done: Promise<{ code: number }>;
  }
  export async function startContainerProcess(
    container: Docker.Container,
    argv: string[],
    options: {
      workingDir?: string;
      env?: string[];
      /** Kill durch einen zweiten, kurzlebigen `exec` im Container — der Hijack-Stream bringt kein `kill` mit. */
      runKill: () => Promise<unknown>;
    },
  ): Promise<ContainerProcessHandle>;
  ```

Vorlage ist `runContainerCommand` (index.ts:1526-1606): derselbe `container.exec({AttachStdin: true, AttachStdout: true, AttachStderr: true, WorkingDir, Env})` + `exec.start({hijack: true, stdin: true})` + Demuxer — nur dass hier **nicht** auf das Stream-Ende gewartet wird, sondern ein Handle zurückgegeben wird.

- [ ] **Step 1: failing tests für die zwei reinen Helper**

In `supervisor-logic.test.ts`:

```ts
  it("records the child pid so a live process can be killed from inside the container", () => {
    expect(sandboxProcessWrapper(["node", "server.js"], "/tmp/rakazo-mcp-1.pid")).toEqual([
      "sh",
      "-c",
      'echo $$ > "$0"; exec "$@"',
      "/tmp/rakazo-mcp-1.pid",
      "node",
      "server.js",
    ]);
  });

  it("kills through the recorded pid and tolerates a process that already exited", () => {
    expect(sandboxProcessKillCommand("/tmp/rakazo-mcp-1.pid")).toEqual([
      "sh",
      "-c",
      'kill -TERM "$(cat "$0")" 2>/dev/null || true',
      "/tmp/rakazo-mcp-1.pid",
    ]);
  });
```

Muster ist `sandboxTimeoutCommand` (supervisor-logic.ts:394-405), das denselben `$0`-Trick für sein completion marker nutzt.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @rakazo/sandbox-supervisor test supervisor-logic`
Expected: FAIL — `sandboxProcessWrapper is not exported`.

- [ ] **Step 3: Helper implementieren**

In `supervisor-logic.ts` direkt nach `sandboxTimeoutCommand`:

```ts
/** Wraps a long-lived process so its pid survives the shell that starts it (exec replaces it). */
export function sandboxProcessWrapper(argv: string[], pidFile: string): string[] {
  return ["sh", "-c", 'echo $$ > "$0"; exec "$@"', pidFile, ...argv];
}

export function sandboxProcessKillCommand(pidFile: string): string[] {
  return ["sh", "-c", 'kill -TERM "$(cat "$0")" 2>/dev/null || true', pidFile];
}
```

- [ ] **Step 4: failing test für das Handle**

`infra/sandboxes/supervisor/src/container-process.test.ts` mit einem Fake-Container, dessen `exec`/`start` einen `stream.PassThrough` zurückgeben (Vorbild für duplex-Hijack-Assertions: `infra/sandboxes/supervisor/src/page-browser-route.test.ts:26,126-128`):

```ts
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { startContainerProcess } from "./container-process.js";

function fakeContainer() {
  const toChild = new PassThrough();
  const fromChild = new PassThrough();
  const exec = {
    start: vi.fn(async () => toChild),
    inspect: vi.fn(async () => ({ ExitCode: 3 })),
  };
  const container = {
    exec: vi.fn(async () => exec),
    // kill läuft über runContainerCommand; im Test wird es injiziert.
  };
  return { container, exec, toChild, fromChild };
}

describe("startContainerProcess", () => {
  it("exposes stdin, demuxed output and the exit code without waiting for the stream to end", async () => {
    const { container, exec, toChild, fromChild } = fakeContainer();
    const seen: Array<{ stream: string; data: string }> = [];
    const handle = await startContainerProcess(container, ["node", "server.js"], {
      workingDir: "/home/rakazo",
      env: ["HOME=/home/rakazo"],
      runKill: async () => ({ stdout: "", stderr: "", code: 0 }),
    });
    handle.onOutput((chunk) => seen.push(chunk));

    // Rohes docker-Frame-Multiplex: stdout-Kanal 1, stderr-Kanal 2, Header 8 Bytes.
    const frame = (channel: number, text: string) => {
      const header = Buffer.alloc(8);
      header[0] = channel;
      header.writeUInt32BE(text.length, 4);
      return Buffer.concat([header, Buffer.from(text)]);
    };
    fromChild.write(frame(1, "ready\n"));
    fromChild.write(frame(2, "warn\n"));
    await Promise.resolve();

    await handle.write('{"jsonrpc":"2.0"}\n');
    expect(toChild.read()).toEqual(Buffer.from('{"jsonrpc":"2.0"}\n'));

    fromChild.end();
    await expect(handle.done).resolves.toEqual({ code: 3 });
    expect(exec.start).toHaveBeenCalledWith({ hijack: true, stdin: true });
    expect(seen).toEqual([
      { stream: "stdout", data: "ready\n" },
      { stream: "stderr", data: "warn\n" },
    ]);
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm --filter @rakazo/sandbox-supervisor test container-process`
Expected: FAIL — Modul existiert nicht.

- [ ] **Step 6: Implementieren**

`container-process.ts`. Die exec-/start-/demuxer-Zeilen sind `runContainerCommand` (index.ts:1549-1573) nachempfunden; neu ist nur, dass das Handle zurückgegeben wird und `done` auf Stream-Ende plus `exec.inspect()` wartet:

```ts
import type Docker from "dockerode";
import { createDockerStreamDemuxer } from "./supervisor-logic.js";

export interface ContainerProcessHandle {
  write(line: string): Promise<void>;
  onOutput(listener: (chunk: { stream: "stdout" | "stderr"; data: string }) => void): void;
  kill(): Promise<void>;
  done: Promise<{ code: number }>;
}

export async function startContainerProcess(
  container: Docker.Container,
  argv: string[],
  options: {
    workingDir?: string;
    env?: string[];
    /** Führt sandboxProcessKillCommand in demselben Container aus. */
    runKill: () => Promise<unknown>;
  },
): Promise<ContainerProcessHandle> {
  const exec = await container.exec({
    Cmd: argv,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: options.workingDir ?? "/home/rakazo",
    Env: options.env ?? ["HOME=/home/rakazo"],
  });
  const stream = (await exec.start({ hijack: true, stdin: true })) as NodeJS.ReadWriteStream;
  const demuxer = createDockerStreamDemuxer();
  const listeners: Array<(chunk: { stream: "stdout" | "stderr"; data: string }) => void> = [];
  const emit = (chunk: { stream: "stdout" | "stderr"; data: string }) => {
    for (const listener of listeners) listener(chunk);
  };

  const done = new Promise<{ code: number }>((resolve, reject) => {
    stream.on("data", (data: Buffer) => {
      for (const piece of demuxer.push(data)) if (piece.data) emit(piece);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      for (const piece of demuxer.finish()) if (piece.data) emit(piece);
      // Ein zerrissener Hijack ist kein Exit: ohne Exit-Code gibt es nichts aufzuräumen.
      void exec
        .inspect()
        .then((info) => resolve({ code: info.ExitCode ?? 0 }))
        .catch(reject);
    });
  });

  return {
    write: (line) =>
      new Promise<void>((resolve, reject) => {
        stream.write(line, (error) => (error ? reject(error) : resolve()));
      }),
    onOutput: (listener) => listeners.push(listener),
    kill: async () => {
      await options.runKill();
      stream.destroy();
    },
    done,
  };
}
```

`done` rejectet bei Stream-**Fehler** (nicht bei Exit), damit ein kaputter Hijack nicht als sauberer Exit mit code 0 gilt.

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @rakazo/sandbox-supervisor test && pnpm lint && pnpm check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add infra/sandboxes/supervisor/src/container-process.ts infra/sandboxes/supervisor/src/container-process.test.ts infra/sandboxes/supervisor/src/supervisor-logic.ts infra/sandboxes/supervisor/src/supervisor-logic.test.ts
git commit -m "feat(supervisor): hold a duplex process handle instead of one captured run"
```

---

### Task 4: Prozess-Registry — Reservierung vor dem Start, identitätsgebundenes Release, Idle-TTL

**Files:**
- Create: `infra/sandboxes/supervisor/src/process-registry.ts`
- Test: `infra/sandboxes/supervisor/src/process-registry.test.ts`

**Interfaces:**
- Consumes: `ContainerProcessHandle` (Task 3).
- Produces:
  ```ts
  export interface RegisteredProcess {
    id: string;
    write(line: string): Promise<void>;
    /** Übernimmt den einzigen Leser. Ein zweiter Aufruf wirft den ersten nicht raus. */
    attachReader(readerId: string, onEvent: (event: ProcessEventLike) => void): () => void;
    kill(reason: string): Promise<void>;
  }
  /**
   * Die Reservierung existiert, bevor der Kindprozess gestartet ist. Ein close, das in diesem
   * Fenster landet, findet deshalb immer einen Eintrag — und `attach` muss ihn töten können.
   */
  export interface ReservedProcess {
    readonly id: string;
    /** Setzelt die Reservierung. Ist sie inzwischen released worden, wird das Handle sofort beendet
     *  und das Ergebnis ist `undefined` — die Route muss daraus `409` machen dürfen. */
    attach(handle: ContainerProcessHandle): RegisteredProcess | undefined;
    /** Start fehlgeschlagen: Eintrag weg, nichts zu töten. */
    abort(): void;
  }
  export interface ProcessRegistry {
    reserve(input: { id: string; computerId: string; botId: string }): ReservedProcess;
    get(id: string): RegisteredProcess | undefined;
    /** Entfernt nur, wenn der Registrierende derselbe ist; sonst bleibt das Handle stehen. */
    release(id: string, readerId: string, reason: string): Promise<void>;
    sweep(now?: number): Promise<string[]>;
  }
  export const MCP_PROCESS_IDLE_MS = 240_000;
  ```

`ProcessEventLike` ist das NDJSON-Ereignis `{type, data?, code?}` — dieselbe Form, die `/exec` schon seit längerem streamt.

**Warum genau so:** openbots `viewer.ts:149-213` nimmt den Claim **vor** jedem await und vergleicht beim Release die Identität des Lesers, weil ein close, das mitten im Start landet, sonst ein Handle ohne Besitzer hinterlässt und ein verdrängter Leser sonst den neuen Leser wegwerfen würde. Beide Eigenschaften sind hier Pflicht und werden getestet. Die Aufteilung in `reserve`/`attach` ist keine Zierde: der Supervisor-Baustein, der das Handle liefert (`startContainerProcess`, Task 3), ist selbst ein await — ein `claim(handle)` **nach** diesem await würde genau das Fenster wieder öffnen, das der Spec-Abschnitt 4.1 schließen will (ein `DELETE` zwischen Start und Registrierung träfe einen leeren Registry-Eintrag und ließe den Prozess als Waise laufen).

- [ ] **Step 1: failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  MCP_PROCESS_IDLE_MS,
  createProcessRegistry,
  type ProcessEventLike,
} from "./process-registry.js";

function handleExit(code: number) {
  let resolveDone!: (value: { code: number }) => void;
  let output: ((chunk: { stream: "stdout" | "stderr"; data: string }) => void) | undefined;
  return {
    write: vi.fn(async () => {}),
    onOutput: vi.fn((listener: typeof output) => {
      output = listener;
    }),
    kill: vi.fn(async () => {}),
    done: new Promise<{ code: number }>((resolve) => {
      resolveDone = resolve;
    }),
    exit: (code: number) => resolveDone({ code }),
    emitOutput: (chunk: { stream: "stdout" | "stderr"; data: string }) => output?.(chunk),
  };
}

describe("process registry", () => {
  it("reserves without awaiting, so a close during start still has something to release", () => {
    const registry = createProcessRegistry();
    const reserved = registry.reserve({ id: "p1", computerId: "c1", botId: "b1" });
    expect(registry.get("p1")).toBeUndefined(); // noch kein Prozess, nur die Reservierung
    reserved.attach(handleExit(0) as never);
    expect(registry.get("p1")?.id).toBe("p1");
  });

  it("kills a handle that arrives after its reservation was already released", async () => {
    // Das ist der Race aus Spec 4.1: DELETE landet zwischen Start und attach.
    const registry = createProcessRegistry();
    const reserved = registry.reserve({ id: "race", computerId: "c1", botId: "b1" });
    await registry.release("race", "operator", "closed during start");
    const handle = handleExit(0);
    reserved.attach(handle as never);
    expect(registry.get("race")).toBeUndefined();
    expect(handle.kill).toHaveBeenCalledTimes(1);
  });

  it("removes the reservation when the start itself fails", () => {
    const registry = createProcessRegistry();
    const reserved = registry.reserve({ id: "failed", computerId: "c1", botId: "b1" });
    reserved.abort();
    expect(registry.get("failed")).toBeUndefined();
  });

  it("releases only for the reader that attached", async () => {
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry
      .reserve({ id: "p2", computerId: "c1", botId: "b1" })
      .attach(handle as never);
    registry.get("p2")!.attachReader("reader-a", () => {});
    await registry.release("p2", "reader-stale", "gone");
    expect(registry.get("p2")).toBeDefined();
    await registry.release("p2", "reader-a", "client disconnected");
    expect(registry.get("p2")).toBeUndefined();
    expect(handle.kill).toHaveBeenCalledTimes(1);
  });

  it("lets a displaced reader go away without dropping the new one", async () => {
    // Der Fall, den openbots viewer.ts:202-213 mit Identitätsvergleich löst.
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry
      .reserve({ id: "swap", computerId: "c1", botId: "b1" })
      .attach(handle as never);
    const detachFirst = registry.get("swap")!.attachReader("reader-a", () => {});
    registry.get("swap")!.attachReader("reader-b", () => {});
    detachFirst();
    await registry.release("swap", "reader-a", "stale detach");
    expect(registry.get("swap")).toBeDefined();
    expect(handle.kill).not.toHaveBeenCalled();
    await registry.release("swap", "reader-b", "client disconnected");
    expect(registry.get("swap")).toBeUndefined();
    expect(handle.kill).toHaveBeenCalledTimes(1);
  });

  it("idle sweeps kill exactly the expired process", async () => {
    const registry = createProcessRegistry({ idleMs: 10 });
    const expired = handleExit(0);
    const fresh = handleExit(0);
    registry.reserve({ id: "old", computerId: "c1", botId: "b1" }).attach(expired as never);
    await new Promise((resolve) => setTimeout(resolve, 20));
    registry.reserve({ id: "new", computerId: "c1", botId: "b1" }).attach(fresh as never);
    expect(await registry.sweep()).toEqual(["old"]);
    expect(expired.kill).toHaveBeenCalledTimes(1);
    expect(fresh.kill).not.toHaveBeenCalled();
  });

  it("keeps the documented idle window below the ten minute suspension", () => {
    expect(MCP_PROCESS_IDLE_MS).toBeLessThan(600_000);
  });

  it("routes output to the current reader and ends with exit", async () => {
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry
      .reserve({ id: "flow", computerId: "c1", botId: "b1" })
      .attach(handle as never);
    const stale: ProcessEventLike[] = [];
    const current: ProcessEventLike[] = [];
    const detachStale = registry.get("flow")!.attachReader("reader-a", (e) => stale.push(e));
    detachStale();
    registry.get("flow")!.attachReader("reader-b", (e) => current.push(e));

    handle.emitOutput({ stream: "stdout", data: "{}\n" });
    handle.exit(7);
    await new Promise((resolve) => setImmediate(resolve));

    expect(stale).toEqual([]);
    expect(current).toEqual([
      { type: "stdout", data: "{}\n" },
      { type: "exit", code: 7 },
    ]);
    expect(registry.get("flow")).toBeUndefined();
  });

  it("drops the entry when the process exits on its own", async () => {
    const registry = createProcessRegistry();
    const handle = handleExit(0);
    registry.reserve({ id: "p3", computerId: "c1", botId: "b1" }).attach(handle as never);
    handle.exit(0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(registry.get("p3")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @rakazo/sandbox-supervisor test process-registry`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: Implementieren**

Kernpunkte, die der Test erzwingt: Map `id → entry`; `reserve` ist **synchron** und schreibt den Eintrag **vor** dem ersten await; `attach` darf einen bereits released-Eintrag nicht wiederbeleben, sondern muss das Handle beenden; `attachReader` ersetzt den bisherigen Leser und liefert eine `detach`-Funktion, die nur dann released, wenn sie noch der aktuelle Leser ist; `release` vergleicht `readerId` (ein Detacher eines verdrängten Lesers findet nichts vor); `sweep` nutzt `lastActivity`, das bei jedem `write`/Event erneuert wird; `handle.done` entfernt den Eintrag ohne kill (der Prozess ist schon weg); TTL-Default `MCP_PROCESS_IDLE_MS = 240_000` (Spec 4.4: deutlich unter der 10-Minuten-Suspension, packages/adapters/src/computer-idle.ts:15).

```ts
import type { ContainerProcessHandle } from "./container-process.js";

export const MCP_PROCESS_IDLE_MS = 240_000;
export type ProcessEventLike = { type: "stdout" | "stderr"; data: string } | { type: "exit"; code: number };
type ReaderSink = (event: ProcessEventLike) => void;

interface Entry {
  id: string;
  computerId: string;
  botId: string;
  handle?: ContainerProcessHandle;
  released: boolean;
  reader: { id: string; onEvent: ReaderSink | undefined };
  lastActivity: number;
}

export function createProcessRegistry(options: { idleMs?: number } = {}): ProcessRegistry {
  const idleMs = options.idleMs ?? MCP_PROCESS_IDLE_MS;
  const entries = new Map<string, Entry>();

  const registered = (entry: Entry): RegisteredProcess => ({
    id: entry.id,
    write: async (line) => {
      if (!entry.handle) throw new Error(`process ${entry.id} is not running`);
      entry.lastActivity = Date.now();
      await entry.handle.write(line);
    },
    attachReader: (readerId, onEvent) => {
      entry.reader = { id: readerId, onEvent };
      return () => {
        // Identitätsvergleich: ein verdrängter Leser darf den neuen nicht rauswerfen.
        if (entry.reader.id === readerId) entry.reader = { id: "", onEvent: undefined };
      };
    },
    kill: async (reason) => {
      entry.released = true;
      entries.delete(entry.id);
      await entry.handle?.kill();
      entry.reader.onEvent?.({ type: "stderr", data: `process closed: ${reason}\n` });
    },
  });

  return {
    reserve(input) {
      const entry: Entry = {
        ...input,
        released: false,
        reader: { id: "", onEvent: undefined },
        lastActivity: Date.now(),
      };
      entries.set(input.id, entry);
      return {
        id: input.id,
        attach(handle) {
          if (entry.released || entries.get(input.id) !== entry) {
            // Die Reservierung ist im Startfenster gone gegangen: der gerade entstandene
            // Prozess hat keinen Besitzer mehr und wird sofort beendet.
            void handle.kill();
            return undefined;
          }
          entry.handle = handle;
          // Hier trifft Ausgabe auf den jeweils aktuellen Leser: ein verdrängter Leser bekommt
          // nichts mehr, und ein noch nicht vorhandener Leser ebenfalls nicht.
          handle.onOutput((chunk) => {
            entry.lastActivity = Date.now();
            entry.reader.onEvent?.({ type: chunk.stream, data: chunk.data });
          });
          void handle.done.then((exit) => {
            entry.lastActivity = Date.now();
            entry.reader.onEvent?.({ type: "exit", code: exit.code });
            entries.delete(input.id);
          });
          return registered(entry);
        },
        abort() {
          if (entries.get(input.id) === entry) entries.delete(input.id);
        },
      };
    },
    get: (id) => {
      const entry = entries.get(id);
      return entry?.handle ? registered(entry) : undefined;
    },
    async release(id, readerId, reason) {
      const entry = entries.get(id);
      if (!entry || entry.reader.id !== readerId) return;
      await registered(entry).kill(reason);
    },
    async sweep(now = Date.now()) {
      const expired = [...entries.values()].filter((entry) => now - entry.lastActivity > idleMs);
      await Promise.all(
        expired.map((entry) => entry.handle?.kill().then(() => entries.delete(entry.id))),
      );
      return expired.map((entry) => entry.id);
    },
  };
}
```

`ReservedProcess.attach` gibt `RegisteredProcess | undefined` zurück — `undefined` ist die einzige Antwort, die dem Router erlauben muss, `409` zu liefern, statt einen toten Prozess als lebendig zu behandeln. In den Interfaces oben entsprechend `attach(handle): RegisteredProcess | undefined;` — die Signatur steht dort, hier nur der Vollständigkeit halber wiederholt, weil der Return-Typ die Routenlogik in Task 5 bestimmt.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @rakazo/sandbox-supervisor test && pnpm lint && pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/sandboxes/supervisor/src/process-registry.ts infra/sandboxes/supervisor/src/process-registry.test.ts
git commit -m "feat(supervisor): own sandbox processes by reader identity, not by lease"
```

---

### Task 5: Prozess-Kanal — Supervisor-Routen und `openProcess` im Docker-Provider

**Files:**
- Modify: `infra/sandboxes/supervisor/src/index.ts` (Routes; die `/exec`-Route reicht von :340-432, `managedContainer` :1095-1102, `supervisorApp`-Export :129)
- Test: `infra/sandboxes/supervisor/src/process-routes.test.ts` (neu)
- Modify: `packages/adapters/src/docker-sandbox.ts` (`openProcess` direkt nach `execute` :179-218; `readNdjsonProcessEvents` :573-619 ist modulprivat und hier nutzbar)
- Test: `packages/adapters/src/docker-sandbox-process.test.ts` (neu)
- Modify: `packages/adapters/src/host-aware-sandbox.ts` (Delegation, Muster :52-72)
- Modify: `packages/adapters/src/sandbox-conformance.test.ts` (Provider-Liste :61-67)

**Interfaces:**
- Consumes: `createProcessRegistry` (Task 4), `startContainerProcess` (Task 3), `managedContainer(id, botId?, spaceId?)` (`docker.getContainer(id)` :1097, wirft `ComputerIdentityError` :1093), `supervisorApp` (:129), `SandboxProcess`/`CommandRequest`/`ProcessEvent` (Task 2), `this.url(path)` (:128-130), `this.headers(context, botId)` (:132-142), `safeBody(res, signal?)` (:36), `readSandboxJson<T>(res, signal, maxBytes?)` (:61), `dockerCwd(request.cwd)` (:666-672), `cancelResponseBody(res)` (:53).
- Produces (exakt diese vier Endpunkte, Spec 4.1):

  | Route | Erfolg | Fehler |
  | --- | --- | --- |
  | `POST /computers/:id/processes` `{argv, env?, cwd?}` | `200 {processId}` | `401` Token, `403` Identität, `413` Body, `422 {error}` ohne/ mit leerem `argv` |
  | `GET /computers/:id/processes/:pid/events` | `200` NDJSON `{type:"stdout"\|"stderr"\|"exit"}` | `404` unbekanntes `processId` |
  | `POST /computers/:id/processes/:pid/stdin` `{data}` | `200 {ok:true}` | `409 {error}` wenn der Prozess nicht (mehr) lebt |
  | `DELETE /computers/:id/processes/:pid` | `200 {ok:true}` | `404` |

**Warum genau so:** Der langlebige Teil ist die **Antwort**. `GET …/events` hat keinen Request-Body und passiert `limitSupervisorRequestBody` (:120-125, gesetzt :157-158) ungelesen — `bodyLimit` greift nur bei vorhandenem Body (Spec 3). Jeder stdin-Frame ist ein kleiner POST **mit** `Content-Length`, also nur an der Größe gemessen (`MAX_SUPERVISOR_REQUEST_BYTES = 1024 * 1024`, :110).

- [ ] **Step 1: failing Route-Test**

`process-routes.test.ts` folgt der bestehenden Konvention aus `page-browser-route.test.ts`: `vi.hoisted`-Mock, `vi.mock("dockerode", …)` dessen `getContainer()` denselben Mock zurückgibt, `beforeEach` mit `mock.inspect.mockResolvedValue({ Config: { Labels: { "rakazo.managed": "true", "rakazo.botId": "home", "rakazo.spaceId": "space" } } })`, und Anfragen über `supervisorApp.request(path, { method, headers, body })` mit `authorization: \`Bearer ${resolveSupervisorToken(process.env)}\`` plus `x-rakazo-bot-id`/`x-rakazo-space-id`. **Kein** eigenes Hono-App-Konstrukt.

Vier Fälle, jeder einzeln begründet. Die zwei Helpers, die der File braucht (keine weiteren Erfindungen):

```ts
const ID = "computer-1";

function identityHeaders(extra: Record<string, string> = {}) {
  return {
    authorization: `Bearer ${resolveSupervisorToken(process.env)}`,
    "content-type": "application/json",
    "x-rakazo-bot-id": "home",
    "x-rakazo-space-id": "space",
    ...extra,
  };
}

async function startProcess(argv: string[]) {
  return supervisorApp.request(`/computers/${ID}/processes`, {
    method: "POST",
    headers: identityHeaders(),
    body: JSON.stringify({ argv }),
  });
}

  it("streams events as ndjson without a request body, so bodyLimit cannot buffer it", async () => {
    const started = await startProcess(["node", "server.js"]);
    expect(started.status).toBe(200);
    const { processId } = (await started.json()) as { processId: string };

    const events = await supervisorApp.request(
      `/computers/${ID}/processes/${processId}/events`,
      { headers: identityHeaders() },
    );
    expect(events.status).toBe(200);
    expect(events.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(events.headers.get("x-accel-buffering")).toBe("no");
  });

  it("refuses a stdin frame for a process that is gone", async () => {
    // 409 ist die einzige Antwort, die der Client von „Frame übernommen" unterscheiden kann.
    const res = await supervisorApp.request(`/computers/${ID}/processes/nope/stdin`, {
      method: "POST",
      headers: identityHeaders(),
      body: JSON.stringify({ data: "{}\n" }),
    });
    expect(res.status).toBe(409);
  });
```

Dazu: `422` bei fehlendem/leeren `argv`, `403` bei Identitäts-Abgleich-Fehler (`ComputerIdentityError` — hier **nicht** den `/exec`-Fehlerpfad kopieren, der fängt generisch und antwortet `200` mit `code: 1`, index.ts:363-365), und der Race-Fall „`DELETE` direkt nach `POST`, noch bevor der Reader anhing" endet mit `200` und getötetem Prozess (Reservierung vor dem Start, Task 4, hier über die Route nachgewiesen). Die bestehende `bodyLimit`-Muster in `index.test.ts:176-199` liefert die Vorlage für die zwei Prämissen-Tests, die Spec 5 verlangt — der ganze Entwurf steht auf ihnen, also werden sie gezeigt und nicht vertraut:

```ts
  it("passes a Content-Length stdin frame through the body limit unread, up to the 1 MiB cap", async () => {
    const started = await startProcess(["node", "server.js"]);
    const { processId } = (await started.json()) as { processId: string };
    const frame = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`;

    const ok = await supervisorApp.request(`/computers/${ID}/processes/${processId}/stdin`, {
      method: "POST",
      headers: identityHeaders(),
      body: frame, // fetch setzt content-length für einen string-body — die Prämisse
    });
    expect(ok.status).toBe(200);
    // Dieselbe Route, ein Body über MAX_SUPERVISOR_REQUEST_BYTES: die Middleware antwortet 413,
    // bevor der Handler liest. Das ist der Cap, den Spec 4.2 fordert — hier gezeigt, nicht behauptet.
    const tooLarge = await supervisorApp.request(`/computers/${ID}/processes/${processId}/stdin`, {
      method: "POST",
      headers: identityHeaders(),
      body: "x".repeat(MAX_SUPERVISOR_REQUEST_BYTES + 1),
    });
    expect(tooLarge.status).toBe(413);
    await expect(tooLarge.json()).resolves.toEqual({ error: "Request body is too large." });
  });
```

`MAX_SUPERVISOR_REQUEST_BYTES` wird aus `index.ts` importiert (exportiert, :110) — dieselbe Zahl, nicht eine abgeschriebene.


- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @rakazo/sandbox-supervisor test process-routes`
Expected: FAIL — die Routen existieren nicht, die Antworten sind `404`.

- [ ] **Step 3: Routen implementieren**

In `index.ts` nach der `/exec`-Route, mit derselben `ReadableStream`-Form wie :368-431 (`encoder` :367, `send`-Closure mit `closed`-Flag :370-381, `finally` mit `controller.close()` im try/catch :414-421, Response-Header :424-431). Die Registry ist ein Modul-Singleton:

```ts
const sandboxProcesses = createProcessRegistry();

const startProcessBody = z.object({
  argv: z.array(z.string()).min(1),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

app.post("/computers/:id/processes", async (c) => {
  const id = c.req.param("id");
  const parsed = startProcessBody.safeParse(await c.req.json().catch(() => undefined));
  // /exec parst mit `.parse()` und antwortet auf einen Identitätsfehler mit 200 + code 1
  // (:345-365). Ein langlebiger Prozess darf beides nicht: `safeParse` für 422, 403 für
  // Identität, damit der Client zwischen „Frame übernommen" und „gibt es nicht" unterscheiden kann.
  if (!parsed.success) return c.json({ error: "argv must be a non-empty array of strings" }, 422);
  let container: Docker.Container;
  let layout: ReturnType<typeof screenPorts>;
  try {
    const managed = await managedContainer(
      id,
      c.req.header("x-rakazo-bot-id"),
      c.req.header("x-rakazo-space-id"),
    );
    container = managed.container;
    const screenId = c.req.header("x-rakazo-screen-id") || c.req.header("x-rakazo-bot-id") || id;
    layout = screenPorts(computerScreens.get(id)?.get(screenId)?.index ?? 0);
  } catch (error) {
    if (error instanceof ComputerIdentityError)
      return c.json({ error: "invalid computer identity" }, 403);
    throw error;
  }
  const processId = randomUUID();
  const pidFile = `/tmp/rakazo-mcp-${processId}.pid`;
  // claim before any await: die Reservierung existiert, bevor der Kindprozess gestartet wird,
  // damit ein close in diesem Fenster etwas vorfindet (Task 4: reserve/attach statt claim).
  const reservation = sandboxProcesses.reserve({
    id: processId,
    computerId: id,
    botId: c.req.header("x-rakazo-bot-id") ?? "",
  });
  try {
    const handle = await startContainerProcess(
      container,
      sandboxProcessWrapper(parsed.data.argv, pidFile),
      {
        workingDir: parsed.data.cwd,
        env: [...computerCommandEnv(layout), ...toEnvList(parsed.data.env)],
        runKill: () =>
          runContainerCommand(container, sandboxProcessKillCommand(pidFile), {
            workingDir: parsed.data.cwd,
            env: computerCommandEnv(layout),
          }),
      },
    );
    const registered = reservation.attach(handle);
    if (!registered) return c.json({ error: "process was closed while starting" }, 409);
  } catch (error) {
    reservation.abort();
    throw error;
  }
  return c.json({ processId });
});
```

`randomUUID` ist in `index.ts` schon importiert (:1) und das pid-Muster folgt dem bestehenden Completion-Marker (:1543). `computerCommandEnv(layout)` (supervisor-logic.ts:559-567) liefert `DISPLAY`/`HOME`/`PATH`/`NPM_CONFIG_PREFIX`/`PIP_USER` und **kein** Control-Token — genau die Env, die ein Fremdprozess bekommen darf; `screenPorts`/`computerScreens` sind dieselben Werte, die `/exec` nutzt (:358-361). `toEnvList` gibt es noch nicht, aber es gibt bereits einen inline Env-Codierer: `/exec` baut `env` mit `Object.entries(body.env ?? {}).map(([k, v]) => \`${k}=${v}\`)` (index.ts:390-392), **ohne** jede Prüfung. Der neue Helper kommt in `supervisor-logic.ts` direkt nach `computerCommandEnv` (:559-567) und übernimmt die Namensregel, die der Host-Pfad schon kennt (`stdioParams`, mcp-transport.ts:258-261 — ungültige Schlüssel werden verworfen, nicht durchgereicht):

```ts
/**
 * Encode a request's env for `docker exec`, allowing only names the shell could express.
 * Mirrors the host stdio path: an unusable key is dropped, never passed through.
 */
export function toEnvList(env: Record<string, string> | undefined): string[] {
  return Object.entries(env ?? {}).flatMap(([key, value]) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? [`${key}=${value}`] : [],
  );
}
```

Die Reihenfolge im Aufruf (`[...computerCommandEnv(layout), ...toEnvList(env)]`) ist Absicht: ein späterer Eintrag gewinnt, ein Preset kann also `PATH` oder `HOME` des Computers überschreiben — exakt das, was der Host-Pfad heute auch zulässt. Diese Parität ist gewollt; eine eigene Sperrliste erfindet eine zweite Wahrheit über dieselbe Env. Nachgewiesen wird sie dort, wo die Env an `container.exec` übergeben wird — im Routen-Test mit dem Fake-Container, der `exec` aufzeichnet:

```ts
  it("puts a request env entry after the computer default so it wins, as the host path does", async () => {
    await supervisorApp.request(`/computers/${ID}/processes`, {
      method: "POST",
      headers: identityHeaders(),
      body: JSON.stringify({ argv: ["node", "s.js"], env: { PATH: "/custom" } }),
    });
    const env = mock.exec.mock.calls[0][0].Env as string[];
    expect(env.filter((entry) => entry.startsWith("PATH=")).at(-1)).toBe("PATH=/custom");
    expect(env.filter((entry) => entry.startsWith("PATH="))).toHaveLength(2);
    expect(env).toContain("HOME=/home/rakazo");
  });
```

Dazu der reine Helper-Fall in `supervisor-logic.test.ts`:

```ts
  it("drops an env name the shell could not express and keeps the rest", () => {
    expect(toEnvList({ FOO: "1", "9BAD KEY": "2", PATH: "/custom" })).toEqual([
      "FOO=1",
      "PATH=/custom",
    ]);
  });
```


Die `events`-Route ruft `registry.get(pid)`, `attachReader(readerId, send)` **vor** dem ersten await, und löst die `ReadableStream`-Start-Funktion exakt wie `/exec` auf; beim Reader-Ende `release(pid, readerId, "client disconnected")`. `readerId` ist pro Verbindung ein `randomUUID()`, nicht die processId — sonst könnte ein zweiter Leser den ersten nicht verdrängen, ohne sich selbst wegzureleasen. `stdin` → 409, wenn `registry.get` leer ist, sonst `write`. `DELETE` → `registry.get(pid)?.kill("operator requested it")` und `404`, wenn nichts mehr da ist; ein Kill braucht keinen Leser, deshalb ist `kill` der richtige Weg und nicht `release`.

Zwei Spec-Punkte, die ohne eigenen Code erfüllt sind und deshalb hier stehen müssen, damit niemand sie nachbaut: Der Frame-Cap aus Spec 4.2 (stdin ≤ 1 MiB) ist **schon** durch die bestehende Middleware abgedeckt — `limitSupervisorRequestBody` mit `MAX_SUPERVISOR_REQUEST_BYTES = 1024 * 1024` (index.ts:110, :157-158) gilt für POST-Bodies mit `Content-Length`, und jeder stdin-Frame ist ein solcher POST; eine zweite Größenprüfung im Handler wäre derselbe Cap, zweimal. Und Spec 4.1 sagt, der Prozess ende „sobald kein stdin-Frame mehr in Bearbeitung ist": der Transport (Task 6) serialisiert Sends in einer Queue, ein Disconnect erwischt höchstens den einen bereits quittierten Frame — `release` direkt beim Reader-Ende ist dieselbe Ordnung, einen Frame früher. Kein extra In-Flight-Zähler.

`ComputerIdentityError` und `managedContainer` sind modulintern (nicht exportiert) — die Routen leben deshalb **in** `index.ts`, nicht in einer neuen Datei.

**Abweichung von Spec 4.1, bewusst:** Die Spec sagt, der Supervisor-Route prüfe `argv` gegen `MCP_STDIO_ALLOWED_COMMANDS`. Die Allowlist ist aber eine Konfiguration der Aufrufer-Seite: sie existiert nur in `apps/api/src/env.ts:178` und `apps/worker/src/index.ts:107` und wird von `stdioParams` (mcp-transport.ts:251-257) durchgesetzt; der Supervisor kennt den Namen nicht und hat keine MCP-Notion. Die Prüfung liegt hier deshalb in `sandboxStdioArgv` (Task 6), **vor** dem POST. Der Supervisor-Route eigene Kopie derselben Policy zu geben wäre eine zweite Wahrheit über dieselbe Zulassung, und die Route erweitert gegenüber `/exec` (index.ts:340-365, nimmt heute beliebiges `argv` vom Token-Inhaber) ohnehin keine Fähigkeit. Wer den Control-Token hält, kann den Container schon beliebig steuern — die Allowlist schützt gegen eine Preset-Konfiguration, und die kommt aus der Aufrufer-Seite. Dieser Verzicht muss in Task 6 als Kommentar an `sandboxStdioArgv` stehen, damit ein Leser der Route nicht eine Prüfung vermutet, die es dort nicht gibt.

- [ ] **Step 4: failing Client-Test**

`docker-sandbox-process.test.ts` mit dem bestehenden Stub-Muster (`vi.stubGlobal("fetch", fetchMock)`, Stream-Antwort als `new Response(new ReadableStream({ start(controller) { … } }), { headers: { "content-type": "application/x-ndjson" } })`, Vorbild :70-91 in `docker-sandbox.test.ts`), Provider als `new DockerSandboxProvider("http://supervisor.test", "test-token")` und dem bestehenden Computer-Fixtur-Stil aus derselben Datei (:40 — `{ id: "computer", botId: "bot", kind: "docker", providerRef: "computer" }`, kein ersonnenes `c-1`):

```ts
const computer = { id: "computer", botId: "bot", kind: "docker", providerRef: "computer" };
const context = { spaceId: "space", userId: "user", botId: "bot", runId: "run" } as never;

  it("starts a process, writes one framed jsonrpc line per call, and stops it again", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (String(url).endsWith("/processes")) return Response.json({ processId: "p-1" });
      if (String(url).endsWith("/events"))
        return new Response(
          new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode(`${JSON.stringify({ type: "stdout", data: "{}\n" })}\n`));
              controller.enqueue(encoder.encode(`${JSON.stringify({ type: "exit", code: 0 })}\n`));
              controller.close();
            },
          }),
          { headers: { "content-type": "application/x-ndjson" } },
        );
      return Response.json({ ok: true });
    }));
    const handle = await provider.openProcess!(computer, { argv: ["node", "s.js"] }, context);
    await handle.write('{"jsonrpc":"2.0","id":1}\n');
    const seen: ProcessEvent[] = [];
    for await (const event of handle.events()) seen.push(event);
    await handle.kill();

    expect(calls.map((call) => call.url)).toEqual([
      "http://supervisor.test/computers/computer/processes",
      "http://supervisor.test/computers/computer/processes/p-1/stdin",
      "http://supervisor.test/computers/computer/processes/p-1/events",
      "http://supervisor.test/computers/computer/processes/p-1",
    ]);
    expect(seen).toEqual([{ type: "stdout", data: "{}\n" }, { type: "exit", code: 0 }]);
  });
```

Zwei weitere Fälle: ein `409` auf `/stdin` muss mit einer Fehlerbotschaft enden, die den Prozess nennt (kein stilles Verschlucken — sonst hält der Transport eine tote Leitung für lebendig), und der Start-Header muss `x-rakazo-bot-id` auf `computerRef.botId` setzen (Containment-Nachweis, nicht Vertrauen).

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm --filter @rakazo/adapters test docker-sandbox-process`
Expected: FAIL — `provider.openProcess` ist `undefined`.

- [ ] **Step 6: Client implementieren**

`openProcess` in `docker-sandbox.ts` : `POST` → `readSandboxJson<{ processId: string }>(res, context.signal)`, dann geschlossenes Handle. `events()` wird **einmal** geöffnet (Vertrag aus Task 2) und nutzt `readNdjsonProcessEvents(res, context.signal)` — ohne `timeoutMs`-Deckel, der Kanal ist langlebig; der Bot-Abbruch bleibt über `context.signal` wirksam. `write(line)` ist genau ein POST pro Frame.

Der Reader-Cap in `readNdjsonProcessEvents` ist hart verdrahtet (`MAX_SANDBOX_SUCCESS_RESPONSE_BYTES`, :593) und für einen einmaligen `exec` richtig, für einen langlebigen MCP-Prozess aber zu klein. Ihn **nicht** uminterpretieren: Signatur auf `readNdjsonProcessEvents(res, signal, maxBytes = MAX_SANDBOX_SUCCESS_RESPONSE_BYTES)` erweitern und im Handle `MAX_SANDBOX_PROCESS_STREAM_BYTES = 64 * 1024 * 1024` übergeben. Der Overflow bleibt ein sichtbares `exit` mit `code: 1`, kein Drop — genau die Spec-4.2-Regel, nur mit einer Zahl, die ein langer Run nicht nach einer Stunde abschneidet. Im Test explizit beide Schwellen behalten: `/exec` bei 16 MiB, `/processes` bei 64 MiB.

- [ ] **Step 7: Delegation und Conformance**

`HostAwareSandbox` (host-aware-sandbox.ts:51) ist der reale Wrapper, den `createRunSandbox` für `docker` liefert (:36) — ohne Delegation hätte der Connector nie ein `openProcess`. Nach dem `pageBrowser`-Muster (:52-72): Feld `readonly openProcess?: SandboxProvider["openProcess"]`, im Konstruktor setzen, wenn `isolated.openProcess` existiert, und über `this.route(computer)` (:78-80) dem Ziel-Provider durchreichen; sonst `undefined` lassen, damit ein Desktop-Computer den Sandbox-Pfad sichtbar nicht bedienen kann.

In `sandbox-conformance.test.ts` die Provider-Liste :61-67 nicht pauschal erweitern — `openProcess` ist optional (Task 2), und `DesktopSandboxProvider` hat per Definition keinen Duplex-Kanal. Stattdessen zwei getrennte Aussagen: (a) jeder Provider, der `openProcess` **deklariert** (docker, HostAware, Emulatoren mit Fake), erfüllt denselben Ereignis-Vertrag wie `execute`; (b) `provider.openProcess === undefined` ist für Desktop ein **erwartetes** Ergebnis, kein Fehler — der Connector muss den Sandbox-Pfad für einen Desktop-Computer sichtbar ablehnen, nicht still auf den Host fallen. Die Liste in :61-67 deshalb um ein `supportsProcess: boolean`-Feld pro Eintrag erweitern, damit (a) und (b) aus derselben Tabelle laufen und nicht zwei Auslegungen desselben Setts existieren.

- [ ] **Step 8: Run tests, lint, typecheck**

Run: `pnpm --filter @rakazo/sandbox-supervisor test && pnpm --filter @rakazo/adapters test && pnpm lint && pnpm check`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add infra/sandboxes/supervisor/src/index.ts infra/sandboxes/supervisor/src/process-routes.test.ts packages/adapters/src/docker-sandbox.ts packages/adapters/src/docker-sandbox-process.test.ts packages/adapters/src/host-aware-sandbox.ts packages/adapters/src/sandbox-conformance.test.ts
git commit -m "feat(sandbox): carry a stdio server over a duplex process channel instead of a captured run"
```

---

### Task 6: `SandboxStdioTransport` — MCP-`Transport` über das Prozess-Handle

**Files:**
- Create: `packages/adapters/src/sandbox-stdio-transport.ts`
- Create: `packages/adapters/src/sandbox-process-fake.ts` (geteilter Fake-Handle, von Task 6 und Task 7 benutzt)
- Test: `packages/adapters/src/sandbox-stdio-transport.test.ts`
- Modify: `packages/adapters/src/mcp-transport.ts` (`sandboxStdioArgv` als neuer Export neben `expandStdioHomeToken` :239; `McpSession.connectSandboxStdio` direkt nach `connectStdio` :381-399)
- Test: `packages/adapters/src/mcp-transport.test.ts` (Fälle für `sandboxStdioArgv`, Konvention :49-68)

**Interfaces:**
- Consumes: `SandboxProcess` (Task 2), `Transport` aus `@modelcontextprotocol/sdk/shared/transport.js` (in `mcp-transport.ts` bereits als `type Transport` importiert, :9; SDK 1.30.0). Der Vertrag dort ist wörtlich: `start(): Promise<void>`, `send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void>`, `close(): Promise<void>`, optional `onclose?: () => void`, `onerror?: (error: Error) => void`, `onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void`, `sessionId?: string`, `setProtocolVersion?: (version: string) => void`. In dieser SDK-Version gibt es **keine** `Session`-Setter — `McpSession` muss nichts weiter erfüllen.
- Produces:
  ```ts
  export const MCP_STDIO_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
  export const MCP_STDIO_MAX_STDERR_BYTES = 64 * 1024;
  export interface SandboxStdioTransportOptions {
    maxBufferedBytes?: number;
    maxStderrBytes?: number;
  }
  export class SandboxStdioTransport implements Transport { … }
  ```
  und in `mcp-transport.ts`:
  ```ts
  export const SANDBOX_STDIO_HOME_ROOT = "/home/rakazo";
  export function sandboxStdioArgv(
    command: string,
    args: readonly string[],
    allowedCommands: readonly string[],
    hostDataDir?: string,
  ): string[];
  ```
  sowie `McpSession.connectSandboxStdio(process: SandboxProcess, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<void>`.

- [ ] **Step 1: Fake-Handle und erste Transport-Tests**

Gegen ein Fake-Handle (kein SDK-Mock, kein Spawn — so testet `mcp-transport.test.ts` auch heute). Der Fake ist die einzige Stelle, an der `events()` steuerbar ist, und Task 7 braucht denselben — Testdateien importieren sich im Repo nicht gegenseitig, also lebt er in einer eigenen Helferdatei nach dem Muster von `packages/adapters/src/fake-sandbox.ts`. Neu: `packages/adapters/src/sandbox-process-fake.ts`:

```ts
import { vi } from "vitest";
import type { ProcessEvent, SandboxProcess } from "@rakazo/adapter-kit";

type Queued = { event: ProcessEvent } | { end: true };
/** Das Handle plus die Buchführung, die der Vertrag nicht hergibt. */
export type FakeProcess = SandboxProcess & { writes: string[] };

export function fakeSandboxProcess() {
  const queue: Queued[] = [];
  const writes: string[] = [];
  const errors: Error[] = [];
  let notify: (() => void) | undefined;
  const wake = () => {
    const fn = notify;
    notify = undefined;
    fn?.();
  };
  const push = (item: Queued) => {
    queue.push(item);
    wake();
  };

  const handle: FakeProcess = {
    id: "proc-fake",
    writes,
    write: async (line: string) => {
      writes.push(line);
    },
    events: async function* () {
      for (;;) {
        while (queue.length === 0) await new Promise<void>((resolve) => (notify = resolve));
        const next = queue.shift() as Queued;
        if ("end" in next) return;
        yield next.event;
      }
    },
    kill: vi.fn(async () => push({ end: true })),
  };

  return {
    handle,
    errors,
    emitStdout: (data: string) => push({ event: { type: "stdout", data } }),
    emitStderr: (data: string) => push({ event: { type: "stderr", data } }),
    emitExit: (code: number) => {
      push({ event: { type: "exit", code } });
      push({ end: true });
    },
  };
}

/** Gibt dem Fake-Handle Gelegenheit, seine wartende Iteration aufzulösen. */
export const flush = () => new Promise((resolve) => setImmediate(resolve));
```

`FakeProcess = SandboxProcess & { writes: string[] }` erweitert den Vertrag um die Buchführung, statt sie mit `as any` durchzubiegen. Die Datei endet **nicht** auf `.test.ts` und enthält keine Tests — sonst läuft sie als leere Suite.


`packages/adapters/src/sandbox-stdio-transport.test.ts`:

```ts
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeSandboxProcess, flush } from "./sandbox-process-fake.js";
import { SandboxStdioTransport } from "./sandbox-stdio-transport.js";

afterEach(() => vi.useRealTimers());

describe("sandbox stdio transport", () => {
  it("never drops a stdout frame: an unterminated overflow kills the process", async () => {
    const fake = fakeSandboxProcess();
    const transport = new SandboxStdioTransport(fake.handle, { maxBufferedBytes: 16 });
    const messages: JSONRPCMessage[] = [];
    transport.onmessage = (message) => messages.push(message);
    transport.onerror = (error) => fake.errors.push(error);
    await transport.start();

    fake.emitStdout('{"jsonrpc":"2.0","id":1,"result":{}}'); // kein newline
    await flush();
    fake.emitStdout("x".repeat(64));

    expect(fake.handle.kill).toHaveBeenCalledTimes(1);
    expect(fake.errors[0]?.message).toContain("buffer");
    expect(messages).toHaveLength(0); // kein halbes Frame wurde zugestellt
  });
```

Weitere Fälle, jeder eine Spec-Aussage: Sends sind **serialisiert** (zwei `send()`-Aufrufe erzeugen genau zwei `/stdin`-POSTs in Ruf-Reihenfolge, und der zweite beginnt erst, als der erste quittiert ist — Spec 4.2 „ein Schreiber pro Prozess"); ein stdout-Frame, der kein gültiges JSON ist, geht als Protokoll-Fehler an `onerror` und tötet den Prozess (kein Raten, kein Verwerfen); stderr wird bei Ankunft auf `maxStderrBytes` gekürzt und setzt ein `truncated`-Flag, das im Fehlerfall an der Nachricht hängt (Spec 4.2, übernommen von openbots trim-while-arriving); `exit` mit Code ungleich 0 schließt sichtbar mit `onerror` **und** `onclose`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @rakazo/adapters test sandbox-stdio-transport`
Expected: FAIL — Modul existiert nicht.

- [ ] **Step 3: Implementieren**

Kernpunkte, die der Test erzwingt: `start()` öffnet genau ein `for await` über `process.events()`; stdout wird an `\n` gesplittert, ein unvollständiger Rest bleibt im Puffer und der Puffer ist auf `maxBufferedBytes` begrenzt (Überlauf: Fehlerpfad, kein Drop); `send()` hängt an eine interne `tail`-Promise-Kette (`JSON.stringify(message) + "\n"` — dasselbe Framing, das `StdioClientTransport` heute tut, Spec 4.3); `close()` ist idempotent, entfernt den Listener und tötet den Prozess nur, wenn er noch nicht beendet ist; nach `close()` laufen eingehende Events ins Leere, ohne `onmessage` noch zu feuern.

- [ ] **Step 4: failing Tests für `sandboxStdioArgv` und `connectSandboxStdio`**

In `mcp-transport.test.ts` (Konvention: reine Aufruf-Assertions, kein Spawn — wie `expandStdioHomeToken` :61-68 und der Allowlist-Fall :49-59):

```ts
  it("builds sandbox argv from the sandbox home root, never the host one", () => {
    expect(
      sandboxStdioArgv("npx", ["-y", "pkg@1", "--state-dir", "{home}/mcp"], ["npx"], "/host/data"),
    ).toEqual(["npx", "-y", "pkg@1", "--state-dir", "/home/rakazo/mcp"]);
    // Derselbe Allowlist-Text wie der Host-Pfad: eine zweite Formulierung wäre eine zweite Wahrheit.
    expect(() => sandboxStdioArgv("bash", [], ["npx"], "/host/data")).toThrow(
      'MCP stdio command "bash" is not in the configured allowlist (MCP_STDIO_ALLOWED_COMMANDS)',
    );
    // ein Host-Pfad im Argument wird abgelehnt, nicht übersetzt (Spec 4.4)
    expect(() =>
      sandboxStdioArgv("npx", ["--dir", "/host/data/homes/bot-1"], ["npx"], "/host/data"),
    ).toThrow("/host/data");
    // ohne bekanntes Host-Root bleibt ein absoluter Pfad unübersetzt, aber erlaubt
    expect(sandboxStdioArgv("npx", ["/etc/passwd"], ["npx"])).toEqual(["npx", "/etc/passwd"]);
  });

  it("refuses a second connect while the sandbox handshake is still in flight", async () => {
    const session = new McpSession();
    const first = session.connectSandboxStdio(fakeSandboxProcess().handle, { timeoutMs: 50 });
    await expect(
      session.connectSandboxStdio(fakeSandboxProcess().handle),
    ).rejects.toThrow("already connected or connecting");
    await expect(first).rejects.toThrow(); // der Fake antwortet nie → Timeout, kein zweiter Aufbau
    await session.close();
  });
```

Der zweite Fall ist absichtlich über den **laufenden** Handshake gebaut: `connectStdio` (:382-383) wirft bei `this.connected || this.connecting`, und genau dieses `connecting`-Fenster ist bei einem gestarteten Container-Prozess lang. Ein Test, der erst nach Abschluss verbindet, bewiese nichts. `fakeSandboxProcess()` liefert ein Handle, das nie auf `initialize` antwortet — der Timeout nach 50 ms ist der erwartete Ausgang und wird nicht verschluckt.

- [ ] **Step 5: Run to verify it fails, then implement**

Run: `pnpm --filter @rakazo/adapters test mcp-transport`
Expected: zuerst FAIL (`sandboxStdioArgv is not exported`), nach Implementierung PASS. `connectSandboxStdio` folgt exakt dem Muster von `connectStdio` (:381-399): `new SandboxStdioTransport(process)`, `this.transport = transport`, `combineSignals(options.signal, AbortSignal.timeout(options.timeoutMs ?? 15_000))`, `this.client.connect(transport, { signal, timeout })`, Fehler durch `mcpConnectError(error, { host: "sandbox stdio" })`.

- [ ] **Step 6: Run tests, lint, typecheck**

Run: `pnpm --filter @rakazo/adapters test && pnpm lint && pnpm check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/adapters/src/sandbox-stdio-transport.ts packages/adapters/src/sandbox-stdio-transport.test.ts packages/adapters/src/sandbox-process-fake.ts packages/adapters/src/mcp-transport.ts packages/adapters/src/mcp-transport.test.ts
git commit -m "feat(adapters): speak MCP over a sandbox process with a real transport, not a pipe illusion"
```

---

### Task 7: Connector-Pfadwahl — ein Prozess pro (Bot, Server), mit Idle-TTL

**Files:**
- Modify: `packages/adapters/src/mcp-connector.ts` (Options im Konstruktor :91-108, stdio-Ast in `connectSession` :377-390, `evict` :322-327, `close` :307-312)
- Test: `packages/adapters/src/mcp-connector.test.ts` (Fixture-Konvention :113-122, Keying-Nachweis :779-817)

**Interfaces:**
- Consumes: `McpSession.connectSandboxStdio` und `sandboxStdioArgv` (Task 6), `SandboxProcess`/`CommandRequest`/`ComputerRef` (Task 2/5), `sessionKey(server, context)` (:314-320, für stdio bereits `botId`-scopend), `this.sessions` (:86).
- Produces: drei neue Einträge im Options-Objekt des Konstruktors —
  ```ts
    /** Deployment switch: run stdio servers in the bot's computer instead of this process. */
    stdioInSandbox?: boolean;
    /** Starts the server process on that bot's computer. */
    openStdioProcess?: (
      computer: ComputerRef,
      request: CommandRequest,
      context: AdapterContext,
    ) => Promise<SandboxProcess>;
    /** The bot's own computer, provisioned through the existing lifecycle path. */
    resolveStdioComputer?: (context: AdapterContext) => Promise<ComputerRef>;
    /** Host `DATA_DIR` root, used only to *reject* arguments that point into it. */
    hostDataDir?: string;
  ```
  und ein Handle-Cache `private readonly sandboxProcesses = new Map<string, SandboxProcess>();` mit `const SANDBOX_STDIO_PROCESS_IDLE_MS = 240_000;` (Spec 4.4; derselbe Wert wie `MCP_PROCESS_IDLE_MS` im Supervisor, Task 4 — zwei Systeme, eine Zahl, commentarverknüpft, weil adapters das infra-Paket nicht importiert).

**Warum genau so:** Der Handle-Schlüssel ist **derselbe** wie der Session-Schlüssel (:314-320), weil beide dieselbe Identität brauchen: stdio ist bereits auf `botId` runtergekeyt, ein Bot mountet sein eigenes home. Ein zweiter Schlüssel wäre eine zweite Wahrheit über dieselbe Zugehörigkeit.

**Abweichung von Spec 4.4, bewusst:** Die Spec übernimmt von openbot die Kapschranken „list 15 s, call 60 s". Die gibt es hier nicht, und diese Planfassung erfindet sie nicht: `listTools` (mcp-connector.ts:154) und `callTool` (:288) übergeben nur `signal`, `McpSession.listTools`/`callTool` (mcp-transport.ts:401-415) reichen ausschließlich `signal` an das SDK weiter — ein Timeout existiert heute nur beim **Verbinden** (`AbortSignal.timeout(options.timeoutMs ?? 15_000)`, :387-389). Eine 60-s-Grenze pro Werkzeugaufruf wäre eine neue Policy für *beide* Pfade (Host und Sandbox), nicht nur für den neuen, und würde lange legitime Tool-Läufe abbrechen. Der Sandbox-Pfad hält deshalb Parität zum Host-Pfad: Handshake 15 s, Aufruf ohne eigene Deckelung, Abbruch über `context.signal`. Wer die 60 s will, führt sie als eigenes, deployment-weites Gate ein — nicht als Nebenprodukt dieses Plans. Diese Entscheidung muss als Kommentar an `connectSandboxStdio` stehen, damit ein Spec-Leser die Zahl nicht als vergessen liest.

- [ ] **Step 1: failing Tests**

In `mcp-connector.test.ts`. `vi.stubGlobal("fetch", mcpFetch(state))` (:43-96) bleibt unverändert — der Sandbox-Pfad ersetzt den **Prozess**, nicht das Protokoll. Der Connector baut die Session selbst (`new McpSession(...)` :358), also werden `connectSandboxStdio` und `listTools` auf dem Prototype gestubbt; sonst hängt der Fall an einem echten Handshake über einem Fake-Handle. Der Pflicht-Nachweis aus Spec 4.4 (ein Prozess pro (Bot, Server), nie geteilt) wörtlich:

```ts
  it("starts one sandbox process per bot and server, and never shares it", async () => {
    const stdioAssignment = {
      ...ASSIGNMENT,
      server: { ...SERVER, transport: "stdio", command: "npx", args: ["-y", "pkg@1"] },
    };
    const first = fakeSandboxProcess();
    const second = fakeSandboxProcess();
    const openStdioProcess = vi
      .fn<
        (
          computer: ComputerRef,
          request: CommandRequest,
          context: AdapterContext,
        ) => Promise<SandboxProcess>
      >()
      .mockResolvedValueOnce(first.handle)
      .mockResolvedValueOnce(second.handle);
    const connect = vi
      .spyOn(McpSession.prototype, "connectSandboxStdio")
      .mockResolvedValue(undefined);
    vi.spyOn(McpSession.prototype, "listTools").mockResolvedValue({ tools: [] });
    const prisma = {
      botMcpServer: {
        findMany: vi.fn().mockResolvedValue([stdioAssignment]),
        findFirst: vi.fn().mockResolvedValue(stdioAssignment),
      },
    };
    const connector = new McpConnector(prisma as never, {} as never, {
      network: TEST_NETWORK,
      stdioEnabled: true,
      allowedCommands: ["npx"],
      stdioInSandbox: true,
      hostDataDir: "/host/data",
      resolveStdioComputer: async (context) =>
        ({
          id: `computer-${context.botId}`,
          botId: context.botId ?? "",
          kind: "docker",
          providerRef: `container-${context.botId}`,
        }) as never,
      openStdioProcess,
    });
    const contextFor = (botId: string) =>
      ({ spaceId: "w1", userId: "u1", botId, signal: new AbortController().signal }) as never;

    await connector.discoverTools(contextFor("bot-1"));
    await connector.discoverTools(contextFor("bot-1"));
    expect(openStdioProcess).toHaveBeenCalledTimes(1); // Cache-Treffer, kein zweiter Prozess

    await connector.discoverTools(contextFor("bot-2"));
    expect(openStdioProcess).toHaveBeenCalledTimes(2);
    expect(openStdioProcess.mock.calls[1]?.[0]).toMatchObject({ botId: "bot-2" });
    // Der Sandbox-Pfad bekommt die Allowlist-argv, nie einen Host-Pfad.
    expect(openStdioProcess.mock.calls[0]?.[1]).toMatchObject({ argv: ["npx", "-y", "pkg@1"] });
    expect(connect).toHaveBeenCalledTimes(2);

    await connector.close();
    expect(first.handle.kill).toHaveBeenCalledTimes(1);
    expect(second.handle.kill).toHaveBeenCalledTimes(1);
  });
```

`fakeSandboxProcess()` kommt aus `./sandbox-process-fake.js` (Task 6 Schritt 1 definiert die Datei; hier nur importiert), `McpSession` aus `import { McpSession } from "./mcp-transport.js"`, damit der Spy das Prototype der Klasse trifft, die der Connector bei :358 selbst konstruiert.

- `runs a stdio server in the bot's computer when the switch is on`: dasselbe Fixture-Gerüst, aber die Behauptung gilt dem **Ausschluss** — `vi.spyOn(McpSession.prototype, "connectStdio")` wird installiert und muss `0`-mal aufgerufen sein (der Host-Pfad darf nicht mehr betreten werden, Spec 4.4).
- `fails visibly when the switch is on but the composition gave no computer`: `resolveStdioComputer` wirft → `discoverTools` wirft mit einer Botschaft, die den Computer nennt, `connectStdio` wieder `0`-mal, und es ist kein Handle in `sandboxProcesses` zurückgelassen.
- `a closed session stops its process`: nach `evict`/`close` ist `kill()` einmal aufgerufen und der Cache leer; ein dritter `discoverTools` startet neu (`openStdioProcess` insgesamt zweimal). TTL-Ablauf wird mit `vi.useFakeTimers()` + `vi.setSystemTime(Date.now() + 240_000)` vor dem dritten Aufruf getestet — derselbe Mechanismus wie bei den bestehenden Session-Fällen, kein eigener Timer im Code.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @rakazo/adapters test mcp-connector`
Expected: FAIL — die Optionen existieren nicht, der stdio-Ast geht weiter über den Host.

- [ ] **Step 3: Implementieren**

Im stdio-Ast (:377) **vor** `stdioEnabled`-Gate und `connectStdio`: bei `this.options.stdioInSandbox` → `sandboxStdioArgv(command, args, allowedCommands, this.options.hostDataDir)` (der Connector liest **kein** `process.env` — die Composition gibt das Host-Root vor, Task 8), Computer über `resolveStdioComputer(context)` (bei fehlender Option: sichtbarer Fehler), Handle aus `sandboxProcesses` nehmen oder `openStdioProcess(computer, { argv, env, cwd: undefined }, context)` und mit `lastActivity`-Stempel ablegen, dann `session.connectSandboxStdio(handle, { signal })`. Der bestehende Host-Zweig bleibt Buchstabe für Buchstabe unverändert (Flag aus = heutiger Codepfad, Global Constraint).

`evict(sessionKey)` (:322) und `close()` (:307) entfernen das Handle und rufen `kill()`; ein Ablaufruf vor dem nächsten Verbinden wirft das Handle weg, statt es wiederzuverwenden. Ein Kill-Fehler ändert die Session-Entscheidung nicht (das Protokoll ist schon weg), aber er wird über den bestehenden Logger sichtbar.

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm --filter @rakazo/adapters test && pnpm lint && pnpm check`
Expected: PASS. Bestehende Connector-Fälle (Keying :779-817, Drift :40, Discovery) müssen unverändert grün bleiben.

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/src/mcp-connector.ts packages/adapters/src/mcp-connector.test.ts
git commit -m "feat(adapters): put a sandboxed stdio server where the bot's own home and identity already are"
```

---

### Task 8: Umschaltung, Composition und ehrliche Doku

**Files:**
- Create: `packages/core/src/mcp-stdio.ts`, `packages/core/src/mcp-stdio.test.ts`
- Modify: `packages/core/src/index.ts` (Barrel-Zeile `export * from "./mcp-stdio.js";` — Stil prüfen mit `grep -n 'export \* from' packages/core/src/index.ts`)
- Modify: `apps/api/src/env.ts` (Feld `:87-88`-Bereich, Wert `:177-178`-Bereich), `apps/api/src/app.ts` (:277-289), `apps/worker/src/index.ts` (:102-116)
- Modify: `.env.example` (Anschluss an `MCP_STDIO_ALLOWED_COMMANDS` :157), `docs/self-host.md`
- Test: `packages/testkit/src/mcp-stdio-sandbox.test.ts` (neu, gated)

**Interfaces:**
- Consumes: `McpConnector`-Optionen (Task 7), `provisionComputer(deps, computerId, context, controlHolder?)` (`computer-lifecycle.ts:150-163`, `deps` = `prisma`/`sandbox`/`home`/`jobs`/`events`/`dataDir?`), `toComputerRef` (`computer-support.ts:6`), das Flag-Muster `deploymentActionFailClosed(env = process.env)` (`action-approval.ts:221-227`).
- Produces: `export function deploymentMcpStdioInSandbox(env: NodeJS.ProcessEnv = process.env): boolean` für `RAKAZO_MCP_STDIO_IN_SANDBOX`, identische Wahrheitstabelle wie das Muster (`"1" | "true" | "yes" | "on"`).

- [ ] **Step 1: failing Core-Test**

`packages/core/src/mcp-stdio.test.ts` nach `action-approval.test.ts:406-415`: leer/`"false"` → `false`; `"1"`, `"true"`, `"yes"`, `"on"` (auch mit Whitespace/Großbuchstaben) → `true`.

Run: `pnpm --filter @rakazo/core test mcp-stdio` → FAIL, Modul fehlt.

- [ ] **Step 2: Flag und Composition implementieren**

`apps/api/src/env.ts` bekommt `mcpStdioInSandbox: boolean` (`source.RAKAZO_MCP_STDIO_IN_SANDBOX` über den Core-Helfer, nicht noch eine eigene Zeichenkette). `apps/worker/src/index.ts` liest denselben Helfer direkt aus `process.env` — **keine** dritte Lesart erfinden.

Beide Wurzeln übergeben die Task-7-Optionen. Der Computer-Resolver ist ein kleiner Closure über den bestehenden Lifecycle-Pfad, exakt wie der Executor ihn fährt (`executor.ts:1617-1619`: Bot laden, `bot.computer` verlangen, `provisionComputer(deps, storedComputer.id, context, "bot")`):

```ts
      stdioInSandbox: env.mcpStdioInSandbox,
      hostDataDir: env.dataDir,
      resolveStdioComputer: async (context) => {
        if (!context.botId) throw new Error("stdio MCP in the sandbox needs a bot identity");
        const bot = await prisma.bot.findUnique({
          where: { id: context.botId },
          select: { computer: { select: { id: true } } },
        });
        if (!bot?.computer) throw new Error("Bot has no computer");
        return provisionComputer({ prisma, sandbox, home, jobs, events, dataDir: env.dataDir }, bot.computer.id, context, "bot");
      },
      openStdioProcess: async (computer, request, context) => {
        if (!sandbox.openProcess)
          throw new Error("this computer provider cannot host a stdio process");
        return sandbox.openProcess(computer, request, context);
      },
```

Im Worker ist `const jobs` **nach** `const mcp` deklariert (`apps/worker/src/index.ts:160` vs. :102). Das ist zulässig, weil der Closure erst während eines Runs ausgeführt wird — den Closure nicht auflösen und die Connector-Konstruktion nicht umhängen; stattdessen ein einzeiliger Kommentar, warum `jobs` hier später aufgelöst wird. Vorher verifizieren: `grep -n "const jobs\|const mcp" apps/worker/src/index.ts`.

- [ ] **Step 3: Doku ohne falsche Isolation**

`.env.example` direkt nach `MCP_STDIO_ALLOWED_COMMANDS` (:157), Stil wie bei `MCP_STDIO_ENABLED` (:149-151): auskommentiert, ein Satz Warum, ein Satz Konsequenz.

`docs/self-host.md` — neuer Absatz im Anschluss an „Reading what a bot was allowed to do" bzw. bei den Computer-Providern, mit dem, was ein Betreiber **nicht** bekommt:
- Containment gilt für Netzwerk und Credentials, **nicht** für Dateien: `data/homes/<botId>` ist in beide Container gemountet (`packages/adapters/src/home.ts:32-41`, Supervisor `index.ts:1172-1177`). Jeder Satz, der Datei-Isolation behauptet, ist ein Fehler.
- Ein Supervisor-Neustart tötet alle MCP-Prozesse; ein Run sieht einen Session-Abbruch. Kein Respawn innerhalb desselben Runs.
- Nach 4 Minuten Idle zahlt der erste Aufrufer Prozessstart und Handshake.
- Die Allowlist (`MCP_STDIO_ALLOWED_COMMANDS`) ist die einzige Filterstufe; sie schützt nicht vor einem bösartigen, erlaubten npm-Paket. Der Zugewinn ist der Radius, nicht die Zulassung.
- Flag aus = Ausführen im API-/Worker-Prozess wie bisher, mit demselben Credential-Radius.

- [ ] **Step 4: Gated Container-Nachweis**

`packages/testkit/src/mcp-stdio-sandbox.test.ts` nach dem Muster `packages/testkit/src/app-image-corepack.test.ts` (Gate auf `VERIFY_DATABASE=1` **und** Docker-Präsenz; sonst `it.skip` mit Begründung). Was hier bewiesen wird und was nicht, im Testkommentar festhalten:
- Nachweis: ein Prozess über `POST /computers/:id/processes` mit `node -e` als stdin-Echo (newline-delimited), Frames hin und zurück über den realen Hijack, dann `DELETE` und **kein** Prozess mehr im Container (`pgrep` über einen kurzen `exec`). Das ist der einzige Teil, der dockerode-Hijack, Registry und Routen zusammen echt testet.
- **Kein** Nachweis: der MCP-Handshake selbst. Ein echtes stdio-MCP-Paket wäre ein Netzwerk-Download und damit kein deterministischer Offline-Test; der Handshake bleibt durch Task 6 gegen das Fake-Handle abgedeckt. Diese Grenze nicht als „E2E grün" verkaufen.

Run: `VERIFY_DATABASE=1 pnpm --filter @rakazo/testkit test mcp-stdio-sandbox` (nur wenn Docker erreichbar; sonst den Skip-Grund im PR-Text nennen).

- [ ] **Step 5: Volle Verifikation**

Run: `pnpm --filter @rakazo/core test && pnpm --filter @rakazo/adapters test && pnpm --filter @rakazo/sandbox-supervisor test && pnpm lint && pnpm check`
Expected: PASS. Zusätzlich Flag-Aus-Regressionsnachweis: `pnpm --filter @rakazo/adapters test mcp-` — alle stdio-Fälle ohne Sandbox-Optionen laufen weiterhin über den Host-Zweig.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/mcp-stdio.ts packages/core/src/mcp-stdio.test.ts packages/core/src/index.ts apps/api/src/env.ts apps/api/src/app.ts apps/worker/src/index.ts .env.example docs/self-host.md packages/testkit/src/mcp-stdio-sandbox.test.ts
git commit -m "feat(deployment): run stdio MCP inside the bot computer behind a switch, with no host fallback"
```

---

## Offene Punkte, die ein Executor klären muss (nicht raten)

- **Kein stiller Rückfall, wenn der Bot-Computer gerade nicht läuft.** Spec 4.4 verlangt: Discovery und Call nehmen denselben Weg wie der Aufruf, und ein Bot ohne laufenden Computer startet ihn über den bestehenden Provision-/Reconnect-Pfad. Das ist **erledigt, nicht offen**: `provisionComputer` (`computer-lifecycle.ts:150`) wartet intern selbst (`waitForComputerReady(deps.prisma, computerId, context)`, :209) und wirft `ComputerBusyError`, wenn ein anderer Run den Boot besitzt (:200, :206, :227, :249-250). Der Resolver in Task 8 wartet nicht selbst, sondern ruft `provisionComputer` und lässt den Fehler durchlaufen; er fällt **nie** auf den Host zurück.
- Die `sandboxProcesses`-Lebensdauer im Connector ist pro Prozess der API/Worker, nicht pro Run. Ein Bot-Reclaim (neuer `providerRef`) macht ein Handle ungültig; der erste `send` scheitert dann und `evict` (:322) räumt auf. Bewusst kein dritter Zustand.
- `toEnvList` ist in Task 5 Schritt 3 mit Code und Test definiert. Der bestehende Inline-Codierer in `/exec` (index.ts:390-392) wird **nicht** angefasst: diese Planfassung ändert keinen bestehenden Request-Pfad, und der neue Helper ist strenger als er, nicht loser.
- `packages/core/src/index.ts` ist alphabetisch sortiert (:1 `./action-approval.js`); die neue Zeile gehört zwischen `./local-*.js` und `./logging.js` einfügen — beim Schreiben einmal gegen `grep -n 'export \* from' packages/core/src/index.ts` prüfen.
