# Bot-Library

Wiederverwendbare Bot-Presets für Rakazo (Export-Format v1).

## Import

1. Rakazo öffnen → **Bots** → Bot erstellen (oder bestehenden Bot öffnen).
2. Die `instructions` aus der gewünschten Preset-Datei in das Bot-Feld **Instruktionen** kopieren,
   Name/Title/Description entsprechend übernehmen.
3. Dem Bot ein Modell zuweisen (z. B. ein SpooK-Modell) und bei Bedarf einen **Private Computer** geben.

Ein automatischer Datei-Import (Drag & Drop) ist in Vorbereitung (Spur B: `bots.import`).
Bis dahin ist der manuelle Weg der offizielle — das Preset-JSON ist exakt im
`export.bot`-Schema (v1) gehalten, damit der Import es direkt konsumieren kann.

## Modell verbinden (SpooK API)

Die Presets brauchen ein verbundenes Modell. SpooK API ist OpenAI-kompatibel:

1. **Settings → Models** (oder Onboarding) → Provider **OpenAI-compatible**.
2. **Server URL:** `https://api.spookapi.xyz/v1` — nicht `spookapi.xyz`; die Website ist nur das Portal, die API liegt unter `api.spookapi.xyz`.
3. **API key** eintragen (SpooK-Konto → Keys) und **Find models** klicken.
4. Token-Pack-Modelle (📦) sind prepaid abgedeckt; 💳-Modelle werden nutzungsabhängig abgerechnet. Für die Presets hier empfohlen: ein 📦 Claude-Modell.

## Presets

| Datei | Bot | Empfohlenes Modell (SpooK) | Zweck |
| --- | --- | --- | --- |
| `openresearch.v1.json` | **OpenResearch** | `claude-sonnet-5` 📦 | Wissenschafts- & Paper-Rechercheur: Literaturrecherche (arXiv, PubMed, OpenAlex), Methodik-Synthese und strukturierte Evidenzberichte. Methodik adaptiert aus [alphaXiv OpenResearch](https://github.com/alphaXiv/OpenResearch) (MIT). |
| `grok-coder.v1.json` | **GrokCoder** | `claude-sonnet-5` 📦 | Autonomer Fullstack- & Systems-Engineer: Terminal-Automation, Debugging, Code-Reviews, Git-Workflows und Test-Driven Development mit strikter Vorab-Verifikation. |
| `trend-scout.v1.json` | **TrendScout** | `deepseek-v4-flash` 📦 | Realtime Tech & AI Monitor: Autonomer Scanner für HackerNews, GitHub Trending und HuggingFace-Paper mit täglichem automatisierbarem Digest (Cron 07:30). |
| `executive-chief.v1.json` | **ExecutiveChief** | `gpt-5.6-fast` / `claude-sonnet-5` 📦 | Chief of Staff & Productivity Lead: Aufgaben-Priorisierung via Eisenhower-Matrix, Daily Standup Briefing (Cron 08:00) und Multi-Bot-Koordination. |
| `data-analyst.v1.json` | **DataAnalyst** | `claude-sonnet-5` / `gemini-3.1-pro` 📦 | Data Science, SQL & Visualization Specialist: Strukturierte CSV/JSON/DuckDB-Analysen, Matplotlib/Seaborn Visualisierungen und statistische Auswertungen. |

