# Design: stdio-MCP-Ausführung im Bot-Computer

- **Date:** 2026-10-04
- **Status:** Approved (Abschnittweise abgenommen)
- **Scope:** Ein stdio-MCP-Server läuft als Prozess im Computer des Bots statt im API-/Worker-Prozess. Ersetzt den Plan `docs/superpowers/plans/2026-10-04-stdio-mcp-in-bot-computer.md`, dessen Kanal-Design auf einer widerlegten Prämisse beruhte.
- **Vergangen:** `2026-09-30-grokbot-features-design.md` (GrokBot-Feature-Design, kein Bezug zu diesem Kanal)

---

## 1. Warum das überhaupt ansteht

`McpSession.connectStdio` (packages/adapters/src/mcp-transport.ts:381-399) spawnt den Server-Kindprozess im API- bzw. Worker-Prozess (apps/api/src/app.ts:277-288, apps/worker/src/index.ts:102-116). Diese Prozesse laden das komplette `.env` (infra/compose/docker-compose.yml:69,106), inklusive `DATABASE_URL`, und mounten `/data` (:93-95). Ein fremdes npm-Paket, das via `npx -y pkg@pin` (apps/web/src/pages/mcp-presets.ts:45-46) gestartet wird, führt also Code neben Datenbankverbindung und Encryption-Key aus. Der Bot-Computer ist bereits die Isolation für Dateien und Browser (`CapDrop ALL`, `no-new-privileges`, eigene Bridge, Env nur DISPLAY/HOME/PATH/Control-Token — computer-spec.ts:292-324) und hat einen anderen Netzwerk- und Credential-Radius.

**Was dieses Design NICHT leistet, und so dokumentiert werden muss:** `data/homes/<botId>` ist in beide Container gemountet (packages/adapters/src/home.ts:32-41 und infra/sandboxes/supervisor/src/index.ts:1172-1177). Containment gilt für Netzwerk und Credentials, **nicht** für das Dateisystem. Eine Doku, die Datei-Isolation behauptet, verkauft etwas, das es nicht gibt.

## 2. Was die Recherche ergeben hat

- openbot hat **kein** stdio-MCP: `StdioClientTransport` kommt im Repo nullmal vor, der einzige MCP-Client ist `StreamableHTTPClientTransport`, die Tabelle `mcp_servers` hat nur `url`. Sie haben das Problem umgangen, nicht gelöst — ihr per-call-Muster (connect/use/close, 15 s list / 60 s call) ist für HTTP billig, für `npx`-Starts im Container aber nicht.
- Ihr einziger Duplex-Kanal ist der Screen (WebSocket `/stream`), mit Producer-Ack als Backpressure und bewusst verworfenen Frames. Verwerfen ist für JSON-RPC-stdout verboten: ein verlorenes Frame ist eine kaputte Antwort. Übernommen wird stattdessen ihr **trim-while-arriving mit explizitem `truncated`-Flag** für stderr (shell.ts:280-309) und ihre **Cap-Zahlen**.
- Ihr claim-before-await-Muster mit Identitätsvergleich beim Release (viewer.ts:149-213) löst genau das Race, das ein „kill when the reader disappears" offen lässt.
- Kein WebSocket bei uns: ihr Vite-Proxy hat ihnen WS-Upgrades zerlegt, und unser HTTP-Weg zum Supervisor puffert Request-Bodies ohnehin.

## 3. Warum der geplante Kanal unmöglich war

`infra/sandboxes/supervisor/src/index.ts:110-125,157-158` stellt `limitSupervisorRequestBody` aus `hono/bodyLimit` vor `/computers` und `/computers/*`. Dessen Implementierung (hono 4.13.7, dist/middleware/body-limit/index.js) liest bei einem Body **ohne** `Content-Length` den Stream vollständig und rekonstruiert ihn als geschlossenen ReadableStream, bevor `next()` läuft. Ein offener stdin-Stream erreicht den Handler also nie, und 1 MiB (`MAX_SUPERVISOR_REQUEST_BYTES`) wäre zusätzlich die Obergrenze.

Zwei Fakten aus demselben Quelltext tragen das neue Design:

1. `if (!c.req.raw.body) return next()` — eine Route **ohne** Request-Body passiert die Middleware unberührt. Der Response-Stream eines langlebigen GET ist von `bodyLimit` nicht betroffen; genau so funktioniert `/exec` bereits produktiv (Supervisor index.ts:368-431, Client packages/adapters/src/docker-sandbox.ts:201-209, 573).
2. Ein POST **mit** `Content-Length` wird nur an der Größe gemessen, nicht gelesen. `fetch` mit einem String-/Buffer-Body setzt `Content-Length` automatisch.

## 4. Architektur

```
McpConnector ──(Flag an)──► SandboxStdioTransport ──► SandboxProvider.openProcess
      │                                                          │
      └──(Flag aus, heute)──► StdioClientTransport (Host)         ▼
                                              POST /computers/:id/processes      → processId
                                              GET  /computers/:id/processes/:pid/events  → NDJSON, langlebig
                                              POST /computers/:id/processes/:pid/stdin   → 1 Frame, Content-Length
                                              DELETE /computers/:id/processes/:pid       → kill
```

Der langlebige Teil ist die **Antwort**, nicht die Anfrage. stdin sind kleine, einzeln quittierte POSTs. Die dockerode-Seite ist vorhanden: `container.exec({AttachStdin})` + `exec.start({hijack: true, stdin})` (Supervisor index.ts:1549-1559) — sie bekommt ein Handle statt eines Abort-Controllers.

### 4.1 Supervisor: Prozess-Tabelle

- `POST /computers/:id/processes` `{ argv, env?, cwd? }` → `200 {processId}`. `argv` wird gegen dieselbe Allowlist geprüft wie der Host-Pfad (`MCP_STDIO_ALLOWED_COMMANDS`, mcp-transport.ts:251-257); ein Container ohne Node oder ohne erlaubtes Kommando startet keinen Prozess.
- Die Tabelle `processId → { stream, stdinWriter, readers, botId, lastActivity }` lebt **nur im Supervisor-Prozess**. Es gibt bewusst kein Lease und keinen persistierten Zustand: ein Supervisor-Neustart rekonstruiert nichts, und ein allenfalls überlebender Kindprozess stirbt an geschlossener stdin (stdio-MCP-Server beenden sich daraus). Der Container-Tod räumt endgültig auf (`container.stop({t:30})`).
- **claim-before-await** (von openbot übernommen): das Handle wird in die Tabelle geschrieben, *bevor* irgendetwas awaited wird, und der Release vergleicht die **Identität des Lesers**, nicht nur die processId. Ein close, das mitten im Start landet, hat damit immer etwas zum Freigeben, und ein verdrängter Leser kann nicht den neuen Leser wegwerfen.
- `GET .../events` schreibt NDJSON `{type:"stdout"|"stderr"|"exit"}` und endet mit `exit` oder Client-Disconnect. Trennt sich der Leser, wird der Prozess beendet, sobald kein stdin-Frame mehr in Bearbeitung ist.
- `POST .../stdin` `{data}` → schreibt einen Frame in den Hijack-Stream, `409` wenn der Prozess nicht (mehr) lebt.
- `DELETE .../processes/:pid` → kill.

### 4.2 Backpressure

stdin hat sie eingebaut: jeder Frame ist ein POST, das der Aufrufer erwartet; der MCP-Transport serialisiert seine Sends in einer Queue, es gibt genau **einen Schreiber pro Prozess**. Deshalb braucht stdin keine Sequenznummern.

stdout hat keinen Ack im JSON-RPC-Protokoll und darf keine Frames verlieren. Der Transport liest kontinuierlich und legt geparste Frames in eine **begrenzte** Queue. Überlauf ist ein Fehler, kein Drop: der Prozess wird beendet und die Session sichtbar geschlossen. Stille Datenvernichtung ist der Modus, den openbot für Screens bewusst wählt („a stale frame is worse than a missing one") — für eine Werkzeugantwort gilt das Gegenteil.

stderr ist Diagnostik: er wird beim Ankommen auf ein Limit gekürzt und bekommt ein explizites `truncated`-Flag, das im Fehlerfall mitgeworfen wird. Er blockiert nie.

### 4.3 Transport

`SandboxStdioTransport` implementiert die `Transport`-Interface des MCP-SDK über dem Handle: `start()` öffnet den events-Stream, `send()` schreibt ein JSON-RPC-Objekt + `\n` als stdin-POST, `onmessage` liefert geparste stdout-Zeilen, `close()` killt. Framing bleibt newline-delimited JSON — identisch zu dem, was `StdioClientTransport` heute tut. Kein neues Protokoll, keine eigene Serialisierung.

### 4.4 Connector, Keying, Lebenszyklus

- `McpConnector` erhält den Sandbox-Provider und einen Computer-Resolver als Pflicht-Abhängigkeit für den Sandbox-Pfad.
- Der Session-Schlüssel bleibt, was er ist (`packages/adapters/src/mcp-connector.ts:314-320`): stdio ist bereits auf `botId` runtergekeyt, weil ein Bot sein home gemountet bekommt. Der Prozess-Handle-Schlüssel ist **derselbe** Schlüssel. Ein Prozess pro (Bot, Server), nie geteilt.
- Idle-TTL 4 Minuten pro Prozess, deutlich vor der 10-Minuten-Idle-Suspension (packages/adapters/src/computer-idle.ts:15,147-150) — die beiden Systeme blockieren sich nie. Der erste Aufrufer nach einer Pause zahlt Handshake und Prozessstart; das ist der bewusste Preis gegenüber „Computer bleibt wach".
- Discovery (Tool-Listung) nimmt denselben Weg wie der Aufruf. Ein Bot ohne laufenden Computer startet ihn über den bestehenden Provision-/Reconnect-Pfad (docker-sandbox.ts:142-168, computer-lifecycle.ts:150,397). Flag an und kein Computer → sichtbarer Fehler, **kein** stiller Host-Fallback; sonst wäre die Containment-Aussage leer.
- Path-Übersetzung: `{home}` (mcp-transport.ts:237-247) expandiert im Sandbox-Pfad nach `/home/rakazo`, nicht nach `DATA_DIR/homes/<botId>`. Jeder andere absolute Host-Pfad in `argv` wird im Sandbox-Pfad **abgelehnt** statt übersetzt — ein Host-Pfad, der stillschweigend im Container landet, ist ein Leak in die Gegenrichtung.
- Kapschranken von openbot übernommen: list 15 s, call 60 s, stdin-Frame ≤ 1 MiB (bestehender Cap), stderr-Buffer begrenzt mit Flag.
- Stirbt der Prozess mitten im Run, schließt die Session mit Fehler; ein automatischer Respawn innerhalb desselben Runs findet nicht statt.

### 4.5 Node im Computer-Image

`infra/sandboxes/computer/Dockerfile` hat python3, uv/uvx, gh, curl, git — **kein** node/npm, obwohl `computer-spec.ts:296` bereits `NPM_CONFIG_PREFIX` setzt. Node-LTS als pinned Tarball mit sha256-Prüfung, genau nach dem Muster von uv (:63-73) und gh (:74) in demselben File. Ohne Node laufen die vier bestehenden npm-Presets im Computer nicht, und das wäre kein Fortschritt, sondern eine Streichung.

### 4.6 Umschaltung

`RAKAZO_MCP_STDIO_IN_SANDBOX` (deployment-weit, aus). Aus = exakt heutiges Verhalten, kein Code-Pfad wird angefasst. An = stdio läuft über diesen Kanal. Neues Feature hinter eigenem Flag, aus, bis es gewinnt (AGENTS.md).

## 5. Teststrategie

- **Offline-Determinismus zuerst.** `SandboxStdioTransport` gegen ein Fake-Handle: Framing, Serialisierung der Sends, Queue-Überlauf → Prozess-Tod (nicht Drop), stderr-Truncation mit Flag, exit → close mit Fehler.
- **Supervisor-Route gegen einen Fake-Docker-Exec:** duplex Hijack wird bereits in `infra/sandboxes/supervisor/src/page-browser-route.test.ts:26,126-128` assertiv getestet — derselbe Aufbau für start/events/stdin/kill, inklusive des Race-Falls „reader schließt vor dem Start" (claim-before-await) und „verdrängter Leser wirft den neuen Leser nicht raus" (Identitäts-Release).
- **Middleware-Nachweis statt Vertrauen:** Tests, die die zwei Prämissen direkt zeigen — ein POST mit `Content-Length` wird von `bodyLimit` ungelesen durchgereicht und liest seinen Body selbst, und die events-Route ohne Body geht unberührt durch die Middleware. Steht diese Prämisse nicht, steht das ganze Design nicht.
- **Provider-Conformance:** `openProcess` in `packages/adapters/src/sandbox-conformance.test.ts` neben `execute`, damit jeder Provider den Vertrag erfüllen muss, nicht nur Docker.
- **Pfad- und Allowlist-Tests:** `{home}` → `/home/rakazo`, Host-Absolute-Pfade → abgelehnt, nicht erlaubtes Kommando → kein Prozess.
- **Echter Container:** ein gated Lauf (`VERIFY_DATABASE`-Muster plus Docker-Präsenz-Gate) mit einem echten stdio-Preset: list + call im Computer, und der Nachweis, dass der Prozess nach TTL oder kill **weg** ist (kein Orphan).
- Kein Desktop-e2e auf der Maintainer-Maschine; CI läuft dort.

## 6. Nichts hiervon ist Scope

- HTTP-MCP (`StreamableHTTP`) ändert nichts — es hat nie einen Prozess gegeben.
- Kein MCP-Server-Imaging, kein Registry-Pinning von Paketen über die bestehende Kommando-Allowlist hinaus.
- Keine Datei-Containment-Behauptung; ein Read-only-Mount des homes wäre ein eigenes Projekt.
- Kein Session-Pool über Bots hinweg (im Gegenteil: bot-keyed bleibt Pflicht).
- Keine Retention für irgendetwas.

## 7. Bekannte Kosten und Risiken

- **Latenz nach Idle:** der erste Aufrufer nach einem TTL-Ablauf zahlt Handshake und Prozessstart. Bewusst gekauft gegen dauerhaft laufende Container.
- **Ein Supervisor-Neustart tötet alle MCP-Prozesse** (Handle-Tabelle ist prozessflüchtig). Läufe, die gerade ein Werkzeug nutzen, sehen einen Session-Abbruch. Akzeptiert, weil die Alternative (Lease-Zustand) ein Zustand ist, den der Neustart nicht rekonstruieren kann.
- **Node im Image** ist ein weiterer Supply-Chain-Pin und Image-Größe; pinned + sha256 nach dem Muster der Nachbarn.
- **`argv`-Allowlist bleibt die einzige Filterstufe** für das, was im Container ausgeführt wird; sie schützt vor willkürlichen Host-Binaries, nicht vor einem bösartigen, erlaubten npm-Paket. Der Zugewinn ist der Radius, nicht die Zulassung.
