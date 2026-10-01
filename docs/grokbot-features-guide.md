# GrokBot-Parität in Rakazo: Dokumentation & Benutzerhandbuch

Dieses Dokument beschreibt, wie die vier Grokbot-Kernmerkmale in Rakazo umgesetzt sind. Stand
2026-09-30, Bezug: Source-Checkout auf Linux (`pnpm dev`, Postgres lokal, `SANDBOX_PROVIDER=docker`).

---

## Inhaltsverzeichnis
1. [Übersicht der vier Merkmale](#1-übersicht-der-vier-merkmale)
2. [Team War Room (Multi-Bot-Gruppenchat)](#2-team-war-room-multi-bot-gruppenchat)
3. [Freigaben vor irreversiblen Aktionen](#3-freigaben-vor-irreversiblen-aktionen)
4. [Second Brain (Notizen im Bot-Home)](#4-second-brain-notizen-im-bot-home)
5. [Voice: Antworten vorlesen](#5-voice-antworten-vorlesen)
6. [Walkthrough in der Web-App](#6-walkthrough-in-der-web-app)
7. [Befehle](#7-befehle)
8. [Verifikation](#8-verifikation)
9. [Abgrenzung](#9-abgrenzung)

---

## 1. Übersicht der vier Merkmale

| Merkmal | Umsetzung in Rakazo | Fundstelle |
| :--- | :--- | :--- |
| **Team War Room** | Gruppen im Space, `@`-Erwähnungen, autonome Delegation | `packages/db/src/groups.ts`, `apps/api/src/team-chat-bridge.ts` |
| **Freigaben** | Konsequente Aktionen erzeugen eine Freigabekarte im Thread | `apps/web/src/components/ApprovalRulesSettings.tsx`, `packages/core/src/action-approval.ts` |
| **Second Brain** | MCP-Preset auf dem Home-Verzeichnis des Bots (`{home}`) | `apps/web/src/pages/mcp-presets.ts` |
| **Voice** | „Diese Antwort vorlesen", Diktieren, Bot-Anruf | `apps/web/src/pages/Shell.tsx`, `apps/mobile/lib/voice.ts` |

---

## 2. Team War Room (Multi-Bot-Gruppenchat)

Gruppen liegen in `chat_groups`/`chat_group_members` (`packages/db/src/groups.ts`) und werden über
das Gruppen-Panel der Web-UI oder per RPC `groups.create` angelegt.

- **Erwähnung im Composer:** `@` adressiert Bot, Gruppe, Routine, Connector oder alle
  (`COMPOSER_MENTION_KINDS` in `packages/core/src/composer-mentions.ts`).
- **Delegation:** Eine Erwähnung ⇒ genau dieser Bot antwortet. Ohne Erwähnung bzw. bei Adressierung
  der Gruppe steuert der Bot die Runde und übergibt Zwischenergebnisse im Thread
  (`apps/api/src/team-chat-bridge.ts`).
- **Roster aus Presets:** `ExecutiveChief` (Koordination), `GrokCoder` (Engineering), `TrendScout`
  (Realtime-Recherche), `DataAnalyst` (Kennzahlen), `OpenResearch` (Literatur).
- **Roster aus Vorlagen:** `bot-library/teams/*.json` beschreibt zehn Teams mit Lead und erster
  Aufgabe, `bot-library/identities/*.json` acht Identitäten („Wer bist du?" → Startteam); die
  Bibliothek umfasst 64 Presets. Die Auswahl im UI fehlt noch.

Raster anlegen und das Routing prüfen:

```bash
pnpm exec tsx scripts/seed-war-room-group.ts     # Gruppe + Preset-Bots
pnpm exec tsx scripts/test-group-chat-mention.ts  # @Mention und Delegation
```

---

## 3. Freigaben vor irreversiblen Aktionen

- **Dauerhaft einstellen** (pro Konto, nicht pro Bot) unter **Settings → Action confirmations**
  (`apps/web/src/components/ApprovalRulesSettings.tsx`).
- **Im Thread:** Konsequente Aktionen — E-Mail-Versand, externe Schreibzugriffe, MCP-Tools —
  erzeugen eine Freigabekarte. Erst nach Bestätigung führt der Executor den Tool-Call aus
  (`packages/core/src/action-approval.ts`, `apps/api/src/mcp-approval.ts`, `packages/adapters/src/executor.ts`).
- **MCP-Server** bestätigt der Bot inline im Chat, ebenso auf Mobile
  (`apps/mobile/components/McpApprovalCard.tsx`).
- Regression: `apps/web/e2e/consequential-approval.spec.ts`.

Damit gilt das Zero-Unintended-Outbox-Prinzip ohne eigenes Python-Tool: Entwürfe entstehen über
verbundene Konnektoren (Gmail, Slack, …), der Versand erst nach der Freigabe.

---

## 4. Second Brain (Notizen im Bot-Home)

Jeder Bot hat ein Home-Verzeichnis. Im Compose-Stack liegt es unter `data/homes/<bot>` auf dem Host,
in den Containern von API und Worker als `/data/homes/<bot>`, und im Sandbox-Container desselben
Bots als `/home/rakazo`.

stdio-MCP-Server starten **neben der API bzw. dem Worker**, nicht im Sandbox-Container. Ein Preset
darf deshalb keinen Sandbox-Pfad nennen: die Presets mit Dateibezug arbeiten mit dem Platzhalter
`{home}` (`apps/web/src/pages/mcp-presets.ts`), den der Connector pro Sitzung durch das Home
**dieses** Bots ersetzt (`expandStdioHomeToken` in `packages/adapters/src/mcp-transport.ts`). Eine
stdio-Sitzung ist daher zusätzlich nach Bot getrennt — Bot A erbt nie das gemountete Home von Bot B.
„Markdown Second Brain" mountet so `{home}/notes` (Obsidian-kompatible Markdown-Notizen),
„Workspace Files" `{home}`, „SQLite & Data Explorer" `{home}/data.db`. Lässt sich kein Home
auflösen, schlägt der Start fehl, statt einen Server mit wörtlichem `{home}`-Argument zu starten.

Voraussetzung: stdio-MCP startet auf dem Server nur, wenn es freigegeben ist (`MCP_STDIO_ENABLED=true`
und der Befehl in `MCP_STDIO_ALLOWED_COMMANDS`). Die UI nennt den fehlenden Schalter direkt am
Preset, statt einen Server zu speichern, der nie startet. Achtung: „Terminal & Code Runner" führt
Befehle im Server-Prozess aus — die Allowlist ist hier die Sicherheitsschwelle, nicht die Sandbox.

Host-Mirror zum Bearbeiten auf dem Rechner:

```bash
pnpm workspace:pull    # Container -> ./workspace
pnpm workspace:push    # ./workspace -> Container
pnpm workspace:watch   # beides, bidirektional
```

Für wiederkehrende Briefings eignen sich Routines (`packages/core/src/cron.ts`); die Presets
`executive-chief` und `trend-scout` bringen welche mit.

---

## 5. Voice: Antworten vorlesen

- **„Diese Antwort vorlesen"** an jeder Bot-Antwort (`apps/web/src/pages/Shell.tsx`), dazu
  Diktieren und Bot-Anruf (Desktop/Mobile).
- **Voraussetzung:** eine Voice-Verbindung in **Settings → Voice** (ElevenLabs, OpenAI, Cartesia
  oder Fish Audio). Ohne Key bleibt die Schaltfläche ohne Ton.
- Ohne Provider arbeitet der Bot weiter im Text; Voice ist eine Ausgabeoption, kein Bot-Feature.

---

## 6. Walkthrough in der Web-App

1. **Stack starten** (`pnpm dev`) und http://127.0.0.1:5173/app öffnen.
2. **Gruppe wählen** in der linken Leiste, oder im Composer `@` tippen und Bot, Gruppe, Routine
   oder Connector adressieren.
3. **Auftrag erteilen**, z. B.:
   > `@ExecutiveChief Bitte koordiniere das Team: @TrendScout nenne einen aktuellen KI-Trend, @DataAnalyst prüfe die Zahlen.`
4. **Freigaben** erscheinen als Karte im Thread, wenn ein Bot etwas Konsequentes tun will.
5. **Anhören** über „Diese Antwort vorlesen" (Voice-Provider unter Settings → Voice).

## 7. Befehle

```bash
# Preset-Bots und War-Room-Gruppe anlegen
pnpm exec tsx scripts/seed-war-room-group.ts
pnpm exec tsx scripts/test-group-chat-mention.ts

# Alle Preset-Bots auf einmal anlegen
pnpm exec tsx scripts/seed-all-bots.ts

# Geteilten Workspace zwischen Container und Host spiegeln
pnpm workspace:pull
pnpm workspace:push
pnpm workspace:watch

# Desktop-App gegen den laufenden Stack
pnpm --filter @rakazo/desktop dev
```

## 8. Verifikation

```bash
pnpm check              # tsc über alle Pakete
pnpm lint               # Biome
pnpm test               # offline Unit- und Contract-Tests
pnpm test:integration   # Postgres-Journeys, braucht Docker
```

## 9. Abgrenzung

Diese Beschreibung nennt bewusst **keine** Python-Tools: `workspace/tools/*.py` und
`workspace/tools/voice_briefing.py` existieren in diesem Repository nicht, ebenso keine
automatisch erzeugten `.wav`-Briefings. E-Mail-Entwürfe laufen über verbundene Konnektoren mit
Freigabekarte, der Notiz-Vault über das MCP-Preset im Bot-Home (`{home}/notes`), Voice über den
Provider in den Voice-Einstellungen.

Kontext-Export für andere LLMs (schließt `.env` und Secrets aus). Das Ergebnis bleibt lokal: es
inlined Pfade aus dem Checkout und ist über `docs/repomix-*.xml` in `.gitignore` gehalten.

```bash
npx repomix --include "docs/**/*.md,bot-library/**/*.json" -o docs/repomix-grokbot-context.xml
```
