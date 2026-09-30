# GrokBot Flagship Features in Rakazo: Dokumentation & Benutzerhandbuch

Dieses Dokument beschreibt die vier Kern-Funktionen aus dem [awesome-grok-bot](https://github.com/RongleCat/awesome-grok-bot) Konzept, die vollständig in Rakazo integriert und verifiziert wurden.

---

## Inhaltsverzeichnis
1. [Übersicht der 4 Flagship-Features](#1-übersicht-der-4-flagship-features)
2. [Feature 1: Multi-Bot Group Chat (Team War Room)](#2-feature-1-multi-bot-group-chat-team-war-room)
3. [Feature 2: E-Mail Drafts mit 1-Click Human-in-the-Loop Approval](#3-feature-2-e-mail-drafts-mit-1-click-human-in-the-loop-approval)
4. [Feature 3: Second Brain & Notes Vault (Obsidian-kompatibel)](#4-feature-3-second-brain--notes-vault-obsidian-kompatibel)
5. [Feature 4: Spoken Voice Notes & Audio-Briefings](#5-feature-4-spoken-voice-notes--audio-briefings)
6. [Benutzer-Walkthrough in der Web-App](#6-benutzer-walkthrough-in-der-web-app)
7. [CLI- & Entwickler-Befehle](#7-cli--und-entwickler-befehle)
8. [Repomix & Kontext-Export](#8-repomix--kontext-export)

---

## 1. Übersicht der 4 Flagship-Features

| Feature | Zweck | Zugriff / Pfad |
| :--- | :--- | :--- |
| **Team War Room** | Kollaborativer Gruppen-Chat mit Multi-Bot-Koordination, `@mentions` und autonomem Hand-off | Web UI: `/app/g/grp_grokbot_war_room` |
| **E-Mail Drafts & Approval** | E-Mails sicher vorbereiten (`WAITING_APPROVAL`); Versand nur nach expliziter Bestätigung | Tool: `workspace/tools/google_assistant.py` |
| **Second Brain Vault** | Obsidian-kompatibles Markdown-Vault für Notizen, Aufgaben und tägliche Briefings | Verzeichnis: `workspace/notes/` |
| **Voice Notes & Audio** | Sprach-Synthese direkt in der UI ("Vorlesen") sowie Offline-Generierung von `.wav` Audio | Tool: `workspace/tools/voice_briefing.py` |

---

## 2. Feature 1: Multi-Bot Group Chat (Team War Room)

Der **Team War Room** bringt spezialisierte KI-Bots in einem gemeinsamen Thread zusammen:

- **ExecutiveChief**: Orchestrierender Teamleiter. Analysiert komplexe Benutzeraufgaben und delegiert Teilaufgaben.
- **GrokCoder**: Autonomer Fullstack- und Systementwickler. Erstellt Code, E-Mail-Entwürfe und technische Spezifikationen.
- **TrendScout**: Echtzeit-Technologie-, KI- und Marktforscher. Liefert aktuelle Signale und Trend-Analysen.
- **DataAnalyst**: Datenanalyst für Kennzahlen, Auswertungen und Dashboards.

### Funktionsweise:
1. **Direkte Erwähnung (`@BotName`):** Wird ein Bot direkt mit `@` angesprochen, übernimmt er gezielt die Antwort.
2. **Autonome Delegation:** Spricht der Nutzer die Gruppe allgemein oder `@ExecutiveChief` an, weist der Chief den anderen Bots selbstständig Aufgaben zu.
3. **Bot-zu-Bot Kommunikation:** Bots übergeben Zwischenergebnisse transparent im Thread (`↪ Empfänger ← Sender`).

---

## 3. Feature 2: E-Mail Drafts mit 1-Click Human-in-the-Loop Approval

Um unerwünschte oder fehlerhafte E-Mail-Aussendungen zu verhindern, gilt das **Zero-Unintended-Outbox-Prinzip**:

1. **Entwurf (Draft):**
   * Bots legen E-Mails stets als Entwurf ab.
   * Gespeichert in `workspace/notes/inbox/drafts.json` mit Status `WAITING_APPROVAL`.
   * Befehl:
     ```bash
     python workspace/tools/google_assistant.py draft --to "team@example.com" --subject "Status" --body "Text"
     ```
2. **Sicherheits-Schranke:**
   * Ein Sendeversuch ohne Freigabe wird hart abgebrochen (`exit code 1`).
3. **Freigabe & Versand:**
   * Durch Übergeben des Flags `--confirm` wird der Entwurf autorisiert:
     ```bash
     python workspace/tools/google_assistant.py send --draft-id draft_xxx --confirm
     ```

---

## 4. Feature 3: Second Brain & Notes Vault (Obsidian-kompatibel)

Alle Erkenntnisse, Aufgaben und Briefings werden in einem standardisierten Markdown-Vault abgelegt:

```text
workspace/notes/
├── README.md               # Vault-Übersicht & Index
├── daily/                  # Tägliche Briefings (z.B. YYYY-MM-DD-briefing.md) mit Frontmatter
├── tasks/                  # Aufgaben, Roadmaps & Projekt-Checklisten (roadmap.md)
├── research/               # Deep-Research Berichte & Markttrends
├── inbox/                  # Entwürfe & ungefilterte Notizen (drafts.json)
└── audio/                  # Generierte Voice-Notes & Audio-Dateien (.wav)
```

### Frontmatter-Standard:
Jedes Daily-Briefing enthält strukturiertes YAML:
```yaml
---
date: 2026-09-30
type: daily-briefing
author: ExecutiveChief
generated_at: 2026-09-30T17:52:19
---
```

---

## 5. Feature 4: Spoken Voice Notes & Audio-Briefings

Rakazo bietet zwei Ebenen der Audio-Synthese:

1. **In-App Vorlesen ("Speak this reply"):**
   * Jede Bot-Antwort im Chat verfügt über einen **Vorlesen**-Button.
   * Ruft `/rpc/voice/prepare` und `/api/voice/speak` auf und spielt die Audiospur direkt im Browser ab.
2. **Lokale & Offline Audio-Synthese:**
   * Das Tool `workspace/tools/voice_briefing.py` nutzt die native Sprachausgabe (`System.Speech` unter Windows bzw. Container-Synthese).
   * Liest automatisch das neueste tägliche Briefing und speichert es als kompakte Audiodatei in `workspace/notes/audio/`.

---

## 6. Benutzer-Walkthrough in der Web-App

1. **Web-App aufrufen:** Im Browser `http://127.0.0.1:5174/app` öffnen.
2. **War Room auswählen:** In der linken Leiste unter **PINNED** auf `GrokBot Team War Room` klicken.
3. **Auftrag erteilen:** Im Eingabefeld unten:
   > `@ExecutiveChief Bitte koordiniere unser Team: @TrendScout nenne einen aktuellen KI-Trend, @GrokCoder erstelle einen Entwurf für die Team-Mail.`
4. **Zuschauen:** TrendScout analysiert die Trends, GrokCoder formuliert den Mail-Entwurf im Chat.
5. **Anhören:** Klicke bei der Antwort auf **Vorlesen**, um die Nachricht vorgelesen zu bekommen.

---

## 7. CLI- & Entwickler-Befehle

```powershell
# E-Mail Entwurf erstellen
python workspace/tools/google_assistant.py draft --to "team@example.com" --subject "Update" --body "Nachricht..."

# E-Mail mit Freigabe absenden
python workspace/tools/google_assistant.py send --draft-id <ID> --confirm

# Spoken Voice Note aus dem neuesten Briefing generieren
python workspace/tools/voice_briefing.py

# Eigenen Text als Audio sprechen lassen
python workspace/tools/voice_briefing.py "Hallo! Das System ist einsatzbereit." -o workspace/notes/audio/custom.wav

# E2E-Test des gesamten Ablaufs im Browser durchführen
node apps/web/test-user-warroom-journey.cjs
```

---

## 8. Repomix & Kontext-Export

Für das Teilen oder Analysieren des gesamten Codes und der Dokumentation mit anderen LLMs (wie z.B. Grok, Claude oder GPT) steht **Repomix** bereit:

```powershell
# Packt die Dokumentation & Tools in eine saubere Datei
npx repomix --include "docs/**/*.md,workspace/tools/*.py,workspace/notes/**/*.md" -o docs/repomix-grokbot-context.xml
```
*Repomix scannt automatisch nach Secrets und schließt `.env`-Dateien und sensible Daten sicher aus.*
