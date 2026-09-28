# GrokBot Parity & Bot Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Rakazo into a self-hosted, full-featured GrokBot alternative (< 5 €/month) by supplying a complete 5-bot library (`OpenResearch`, `GrokCoder`, `TrendScout`, `ExecutiveChief`, `DataAnalyst`), zero-cost realtime scraping tools, and Telegram mobile bridge enablement.

**Architecture:** 
- Manifests adhere to Rakazo's `ExportManifestSchema` (v1) in `bot-library/*.v1.json`, verified via `@rakazo/contracts` vitest suites.
- Bots run with dedicated/team Docker computers leveraging SpooK API Token-Pack models (`claude-sonnet-5` for deep reasoning/coding, `deepseek-v4-flash` for high-throughput trend-scanning, `gpt-5.6-fast` for triage).
- Realtime web trends use standalone Python scripts (`fetch-tech-trends.py`) running inside the bot's sandbox (no paid X-API required).
- Telegram integration uses Rakazo's native `@chat-adapter/telegram` already wired in `packages/adapters`.

**Tech Stack:** TypeScript, Node.js 22, React / Vite, Prisma / PostgreSQL 16, Docker, Vitest, SpooK API / OpenAI-compatible.

**Spec:** [GrokBot Parity & Bot Catalog Blueprint](file:///c:/Users/pasca/Downloads/ssd/rakazo/bot-library/README.md)

## Global Constraints
- Zero merge conflicts with Track B: do not touch `apps/api/src/router.ts` or database migration scripts in `packages/db`.
- All model selections must default to verified SpooK API Token-Pack models (`claude-sonnet-5`, `deepseek-v4-flash`, `gpt-5.6-fast`).
- All bot manifests must validate 100% against `ExportManifestSchema` (v1).
- No secrets or raw API tokens hardcoded in any committed files.

---

### Task 1: Complete Bot Library Presets (`TrendScout`, `ExecutiveChief`, `DataAnalyst`)

**Files:**
- Create: `bot-library/trend-scout.v1.json`
- Create: `bot-library/executive-chief.v1.json`
- Create: `bot-library/data-analyst.v1.json`
- Modify: `packages/contracts/src/openai-compatible-ui.test.ts`
- Modify: `bot-library/README.md`

**Interfaces:**
- Consumes: `ExportManifestSchema` from `@rakazo/contracts`
- Produces: 3 validated JSON bot manifests in `bot-library/`

- [ ] **Step 1: Write failing test in `openai-compatible-ui.test.ts` expecting all 5 presets**

```typescript
describe("bot-library presets", () => {
  it("validates all 5 bot presets against ExportManifestSchema", () => {
    const presets = [
      "openresearch.v1.json",
      "grok-coder.v1.json",
      "trend-scout.v1.json",
      "executive-chief.v1.json",
      "data-analyst.v1.json",
    ];
    for (const filename of presets) {
      const filePath = path.resolve(process.cwd(), "bot-library", filename);
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = ExportManifestSchema.parse(JSON.parse(raw));
      expect(parsed.version).toBe(1);
      expect(parsed.bot.name.length).toBeGreaterThan(0);
      expect(parsed.memory.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails (missing presets)**

Run: `docker exec -u root rakazo-web-1 pnpm --filter @rakazo/contracts test`
Expected: FAIL with `ENOENT: no such file or directory, trend-scout.v1.json`

- [ ] **Step 3: Implement `trend-scout.v1.json`**

Create `bot-library/trend-scout.v1.json` with role:
- Name: `TrendScout`
- Title: `Realtime Tech & Market Monitor`
- Description: `Autonomer Scanner für HackerNews, GitHub Trending, AI-Preprints und Branchen-News.`
- Instructions: Playbook for parsing RSS feeds, extracting trend signals, deduplicating news, and summarizing developments in structured bullet points.
- Model: `deepseek-v4-flash`
- Memories: `guidelines/trend-sources.md`, `guidelines/scoring-rubric.md`
- Routine: Daily Tech Digest at 07:30 (`30 7 * * *`).

- [ ] **Step 4: Implement `executive-chief.v1.json`**

Create `bot-library/executive-chief.v1.json` with role:
- Name: `ExecutiveChief`
- Title: `Chief of Staff & Productivity Lead`
- Description: `Strukturierter Koordinator für Aufgaben-Priorisierung, Daily Briefings, Scratchpad-Triage und Projekt-Roadmaps.`
- Instructions: Daily standup routines, Eisenhower matrix prioritization, task extraction from unstructured meeting notes.
- Memories: `guidelines/triage-matrix.md`, `guidelines/daily-briefing-format.md`
- Routine: Morning Briefing at 08:00 (`0 8 * * 1-5`).

- [ ] **Step 5: Implement `data-analyst.v1.json`**

Create `bot-library/data-analyst.v1.json` with role:
- Name: `DataAnalyst`
- Title: `Data Science, SQL & Visualization Specialist`
- Description: `Experte für CSV-/JSON-Analysen, SQL-Abfragen, statistische Auswertungen und interaktive Visualisierungen.`
- Instructions: Python/Pandas workflows, data validation, chart rendering, statistical summaries, artifact persistence.
- Memories: `guidelines/python-data-stack.md`, `guidelines/chart-guidelines.md`

- [ ] **Step 6: Update `bot-library/README.md` catalog table**

Add all 5 bots with purpose, recommended SpooK model, and capabilities.

- [ ] **Step 7: Run test to verify it passes**

Run: `docker cp bot-library rakazo-web-1:/app/bot-library; docker cp packages/contracts/src/openai-compatible-ui.test.ts rakazo-web-1:/app/packages/contracts/src/openai-compatible-ui.test.ts; docker exec -u root rakazo-web-1 pnpm --filter @rakazo/contracts test`
Expected: PASS (all 84+ tests green).

---

### Task 2: Multi-Bot Database Seeder (`scripts/seed-all-bots.ts`)

**Files:**
- Create: `scripts/seed-all-bots.ts`
- Modify: `package.json` (add convenience script `db:seed-bots`)

**Interfaces:**
- Consumes: All `.v1.json` files from `bot-library/`, `createDb` & `createRepos` from `@rakazo/db`
- Produces: 5 active, populated bots in PostgreSQL with threads, browser profiles, memories, and routines.

- [ ] **Step 1: Write `scripts/seed-all-bots.ts`**

Iterate over all manifests in `bot-library/*.v1.json`:
- Check if bot exists by name; if exists, update instructions/title/description and ensure model is set to assigned SpooK model.
- If not, call `repos.createBot(actor, ...)`.
- Upsert all memories from manifest.
- Upsert all routines from manifest.
- Print clear summary table of seeded bots with their IDs.

- [ ] **Step 2: Run seeder in `rakazo-api-1` container**

Run: `docker cp scripts/seed-all-bots.ts rakazo-api-1:/app/scripts/seed-all-bots.ts; docker exec -u root rakazo-api-1 pnpm --filter @rakazo/api exec tsx /app/scripts/seed-all-bots.ts`
Expected: Outputs `Seeding 5 bots completed successfully! OpenResearch, GrokCoder, TrendScout, ExecutiveChief, DataAnalyst`.

- [ ] **Step 3: Verify via database query**

Run: `"SELECT name, title, ""modelId"" FROM bots WHERE ""archivedAt"" IS NULL;" | docker exec -i rakazo-postgres-1 psql -U rakazo -d rakazo`
Expected: 5 active bots displayed.

---

### Task 3: Zero-Cost Trend-Scraper Script (`bot-library/scripts/fetch-tech-trends.py`)

**Files:**
- Create: `bot-library/scripts/fetch-tech-trends.py`

**Interfaces:**
- Input: Optional flags `--sources hn,github,arxiv` `--limit 10`
- Output: Clean JSON array of `{ title, url, source, score, summary, timestamp }`

- [ ] **Step 1: Write `fetch-tech-trends.py`**
- Uses only Python standard library (`urllib.request`, `xml.etree.ElementTree`, `json`).
- HackerNews: fetches `https://hacker-news.firebaseio.com/v0/topstories.json` and top 10 item details.
- GitHub Trending: fetches daily trending repositories via public RSS/Atom.
- arXiv CS.AI: fetches newest papers via public arXiv API `http://export.arxiv.org/api/query?search_query=cat:cs.AI`.
- Emits structured JSON to stdout.

- [ ] **Step 2: Test scraper execution**

Run: `python bot-library/scripts/fetch-tech-trends.py --limit 5`
Expected: Valid JSON with news items from HN, GitHub, and arXiv in under 3 seconds.

---

### Task 4: Telegram Mobile Bridge Setup & Verification

**Files:**
- Create: `docs/messaging/telegram-setup.md`
- Test: Environment variable mapping in `packages/adapters/src/messaging-platforms.ts`

**Interfaces:**
- Consumes: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`
- Produces: Two-way chat connection between Telegram mobile app and Rakazo bots.

- [ ] **Step 1: Document Telegram BotFather step-by-step setup in `docs/messaging/telegram-setup.md`**
- Registering bot with `@BotFather`.
- Setting webhook endpoint: `https://<vps-domain>/api/messaging/telegram/webhook`.
- Setting environment variables in `.env`.
- Pairing code flow (`/pair <code-from-rakazo-ui>`).

- [ ] **Step 2: Verify adapter conformance with vitest**

Run: `docker exec -u root rakazo-web-1 pnpm --filter @rakazo/adapters test packages/adapters/src/messaging-platforms.test.ts`
Expected: PASS.

---

### Task 5: Interactive HTML & Artifact Sandbox in Web UI

**Files:**
- Modify: `packages/chat-ui/src/artifact-item.tsx` or `apps/web/src/pages/Artifacts.tsx`
- Test: UI component test or manual verification on `http://127.0.0.1:5174`

**Interfaces:**
- Consumes: Artifact MIME types (`text/html`, `image/svg+xml`, `text/vnd.mermaid`)
- Produces: Sandboxed `<iframe>` live preview toggle alongside code view.

- [ ] **Step 1: Check existing artifact rendering in web client**
- [ ] **Step 2: Add sandboxed iframe preview for HTML and SVG artifacts**
- [ ] **Step 3: Rebuild `@rakazo/web` and restart container**
- [ ] **Step 4: Verify on `http://127.0.0.1:5174`**
