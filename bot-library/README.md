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

## Eigene Presets

Fünf Presets sind hier entstanden; die anderen 56 sind wortgetreu übernommen (siehe unten).

| Datei | Bot | Anforderung ans Modell | Zweck |
| --- | --- | --- | --- |
| `openresearch.v1.json` | **OpenResearch** | starkes Reasoning-Modell | Wissenschafts- & Paper-Rechercheur: Literaturrecherche (arXiv, PubMed, OpenAlex), Methodik-Synthese und strukturierte Evidenzberichte. Methodik adaptiert aus [alphaXiv OpenResearch](https://github.com/alphaXiv/OpenResearch) (MIT). |
| `grok-coder.v1.json` | **GrokCoder** | starkes Coding-Modell | Autonomer Fullstack- & Systems-Engineer: Terminal-Automation, Debugging, Code-Reviews, Git-Workflows und Test-Driven Development mit strikter Vorab-Verifikation. |
| `trend-scout.v1.json` | **TrendScout** | schnelles Modell (viele Läufe/Tag) | Realtime Tech & AI Monitor: Autonomer Scanner für HackerNews, GitHub Trending und HuggingFace-Paper mit täglichem automatisierbarem Digest (Cron 07:30). |
| `executive-chief.v1.json` | **ExecutiveChief** | starkes Modell, geringe Latenz für den Chat | Chief of Staff & Productivity Lead: Aufgaben-Priorisierung via Eisenhower-Matrix, Daily Standup Briefing (Cron 08:00) und Multi-Bot-Koordination. |
| `data-analyst.v1.json` | **DataAnalyst** | starkes Modell mit Code-Ausführung | Data Science, SQL & Visualization Specialist: Strukturierte CSV/JSON/DuckDB-Analysen, Matplotlib/Seaborn Visualisierungen und statistische Auswertungen. |

## Übernommene GrokBot-Profile

**56** der 61 Presets stammen aus der CC0-Sammlung
[awesome-grokbot](https://github.com/mergisi/awesome-grokbot), vollständig: development (8),
productivity (8), marketing (10), ops (17), sales (8), personal (5). Der Prompt-Text ist
**wortgetreu** übernommen, weil die Sammlung ausdrücklich darum bittet, ein Profil unverändert zu
verwenden. Name und `integrations` stammen aus dem Front Matter, die Beschreibung aus der ersten
Zeile unter „What you do"; `title` bleibt leer, damit nichts erfunden wird.

Weitere Profile übertragen (gleiche Slugs werden überschrieben) — sinnvoll, wenn die Sammlung
wächst:

```bash
node scripts/import-grokbot-profiles.mjs marketing/viral-tweet-scout ops/chief-of-staff
pnpm exec biome check --write bot-library   # JSON auf die Repo-Formatierung bringen
```

Der Import liest `PROFILE.md` und schreibt `bot-library/<slug>.v1.json`. Jedes Preset wird geprüft
(`apps/api/src/bot-library-presets.test.ts`): kein Preset darf einen Skriptpfad nennen, den kein
Image ausliefert, und jede Routine braucht Prompt und Zeitplan. Ein Profil, das das verletzt, wird
nicht übernommen.

## Identitäten

`identities/*.json` sind die Antwort auf „Wer bist du?" beim Start: acht Identitäten der Vorlage
(X creator, Engineer, Independent founder, Manager, Marketer, Sales, Researcher, Parent). Eine
Identität beschreibt keinen Bot, sie nennt nur das Team, mit dem ein neuer Space anfängt — damit
stellt der erste Bildschirm eine Frage statt eines leeren Rosters.

| Datei | Identität | Startteam |
| --- | --- | --- |
| `creator.json` | X creator | Creator team |
| `engineer.json` | Engineer | Eng team |
| `founder.json` | Independent founder | Desk team |
| `manager.json` | Manager | Ops team |
| `marketer.json` | Marketer | Marketing team |
| `parent.json` | Parent | Personal team |
| `researcher.json` | Researcher | Research team |
| `sales.json` | Sales | Sales team |

## Teams

`teams/*.json` sind Roster statt einzelner Bots: das erste Mitglied ist der Lead und bekommt beim
Anlegen die `firstTask`. Ein Team bleibt bei 2–4 Bots, weil ein fünfter Bot ein zweites Team ist.

Sechs Roster sind die Starter-Teams der Vorlage, unverändert in der Auswahl übernommen
(`goals/*.md` der Sammlung); die übrigen vier sind eigene Zusammenstellungen aus derselben
Bibliothek.

| Datei | Team | Lead zuerst |
| --- | --- | --- |
| `eng-team.json` | Eng team | Bug Reproduction, Issue Drafter, PR Reviewer |
| `sales-team.json` | Sales team | Outbound Voice, Call Followup |
| `success-team.json` | Success team | Account Health, Support Replies |
| `marketing-team.json` | Marketing team | Social Queue, Content Remix |
| `ops-team.json` | Ops team | Chief of Staff, Daily Brief |
| `personal-team.json` | Personal team | Trip Concierge, Household Ops |
| `research-team.json` | Research team | ExecutiveChief, TrendScout, OpenResearch |
| `creator-team.json` | Creator team | Viral Tweet Scout, Content Remix, Reddit Comment Finder |
| `desk-team.json` | Desk team | Inbox Triage, Meeting Notes, Standup Desk, Focus Defender |
| `finance-team.json` | Finance team | Cloud Spend, Expense Manager, SaaS Finance |

Geladen werden sie mit `listTeamTemplates()` und `listIdentities()` (`apps/api/src/bot-library.ts`).
Jedes genannte Preset und jedes Startteam wird gegen die Bibliothek aufgelöst; ein Tippfehler fällt
im Test auf statt beim Anlegen.

