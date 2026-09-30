# Bot-Library

Wiederverwendbare Bot-Presets für Rakazo (Export-Format v1).

## Import

1. Rakazo öffnen → **Bots** → Bot anlegen → **Import preset**.
2. Eine `*.v1.json`-Datei wählen. Das Preset wird vorab angezeigt; Speicher, Routinen und Dateien
   sind einzeln ab- oder anwählbar.
3. Danach dem Bot ein Modell zuweisen und bei Bedarf einen Computer geben (**Private** oder
   geteilt).

Der Import läuft über `bots.import` und akzeptiert genau das Export-Schema v1 — dieselbe Form, die
der Bot-Export in der Web-UI erzeugt. Der manuelle Weg (Instruktionen aus der Datei kopieren) bleibt
möglich, ist aber nicht mehr nötig.

## Modell verbinden

Die Presets sind providerneutral; sie brauchen nur irgendein verbundenes Modell. In **Settings →
Models** (oder im Onboarding) eine Verbindung anlegen:

1. Katalog-Anbieter wählen (OpenAI, Anthropic, OpenRouter, …) oder **OpenAI-compatible** für einen
   eigenen Endpunkt.
2. Bei **OpenAI-compatible**: Server-URL eintragen, **Find models** klicken, Modell wählen. Ein API-Key
   ist optional und nur nötig, wenn der Server ihn verlangt; für öffentliche Hostnamen setzt die
   `.env` `RAKAZO_OPENAI_COMPAT_ALLOW_PUBLIC=1`.
3. Laufzeit und Kosten richten sich nach der Modellwahl: Der Trend-Scan läuft viele Male am Tag und
   braucht ein schnelles Modell, die übrigen Presets ein starkes Coding- bzw. Reasoning-Modell.

## Presets

| Datei | Bot | Anforderung ans Modell | Zweck |
| --- | --- | --- | --- |
| `openresearch.v1.json` | **OpenResearch** | starkes Reasoning-Modell | Wissenschafts- & Paper-Rechercheur: Literaturrecherche (arXiv, PubMed, OpenAlex), Methodik-Synthese und strukturierte Evidenzberichte. Methodik adaptiert aus [alphaXiv OpenResearch](https://github.com/alphaXiv/OpenResearch) (MIT). |
| `grok-coder.v1.json` | **GrokCoder** | starkes Coding-Modell | Autonomer Fullstack- & Systems-Engineer: Terminal-Automation, Debugging, Code-Reviews, Git-Workflows und Test-Driven Development mit strikter Vorab-Verifikation. |
| `trend-scout.v1.json` | **TrendScout** | schnelles Modell (viele Läufe/Tag) | Realtime Tech & AI Monitor: Autonomer Scanner für HackerNews, GitHub Trending und HuggingFace-Paper mit täglichem automatisierbarem Digest (Cron 07:30). |
| `executive-chief.v1.json` | **ExecutiveChief** | starkes Modell, geringe Latenz für den Chat | Chief of Staff & Productivity Lead: Aufgaben-Priorisierung via Eisenhower-Matrix, Daily Standup Briefing (Cron 08:00) und Multi-Bot-Koordination. |
| `data-analyst.v1.json` | **DataAnalyst** | starkes Modell mit Code-Ausführung | Data Science, SQL & Visualization Specialist: Strukturierte CSV/JSON/DuckDB-Analysen, Matplotlib/Seaborn Visualisierungen und statistische Auswertungen. |

## Übernommene GrokBot-Profile

`pr-reviewer`, `changelog-bot`, `issue-drafter`, `docs-writer`, `bug-reproduction`, `repo-hardener`,
`deploy-watch`, `query-helper` und `daily-brief` stammen aus der CC0-Sammlung
[awesome-grokbot](https://github.com/mergisi/awesome-grokbot). Der Prompt-Text ist **wortgetreu**
übernommen, weil die Sammlung ausdrücklich darum bittet, ein Profil unverändert zu verwenden. Name
und `integrations` stammen aus dem Front Matter, die Beschreibung aus der ersten Zeile unter
„What you do"; `title` bleibt leer, damit nichts erfunden wird.

Weitere Profile übertragen:

```bash
node scripts/import-grokbot-profiles.mjs sales/qbr-pack-builder ops/incident-desk
```

Der Import liest `PROFILE.md` und schreibt `bot-library/<slug>.v1.json`; gleiche Slugs werden
überschrieben.

