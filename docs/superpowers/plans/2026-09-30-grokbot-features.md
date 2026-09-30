# GrokBot Core Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 4 flagship GrokBot features in Rakazo: Multi-Bot Group Chat (War Room), Email Drafts with 1-Click Approval, Second Brain Vault, and Voice Notes / Audio Briefings.

**Architecture:** We build upon Rakazo's native Postgres group chat schema, approval effect mechanism, shared workspace notes vault, and Python standard/TTS tools. Turn-taking supports both explicit `@mentions` and autonomous orchestration led by `ExecutiveChief`.

**Tech Stack:** TypeScript, Node.js / tsx, Prisma, PostgreSQL, Docker, Python 3 (standard library + Edge-TTS).

**Spec:** `docs/superpowers/specs/2026-09-30-grokbot-features-design.md`

## Global Constraints
- Secrets policy strictly enforced: never print or expose secrets or environment keys.
- Preserve all existing comments and docstrings.
- Evidence before assertions: run verification scripts and confirm output.

---

### Task 1: Multi-Bot Group Chat (War Room) Seeding & Mentions

**Files:**
- Create: `scripts/seed-war-room-group.ts`
- Create: `scripts/test-group-chat-mention.ts`
- Modify: `packages/db/src/groups.ts` (if needed)

**Interfaces:**
- Produces: A seeded group `grp_grokbot_war_room` with members `ExecutiveChief`, `GrokCoder`, `TrendScout`, and `DataAnalyst`.
- Produces: CLI script to simulate user prompts in the group chat and verify bot responses.

- [ ] **Step 1: Write `scripts/seed-war-room-group.ts`**
  - Locate space and existing 4 bots.
  - Upsert `chat_groups` record with `id: "grp_grokbot_war_room"`, `name: "GrokBot Team War Room"`.
  - Upsert all 4 bots into `chat_group_members`.
  - Ensure a corresponding `threads` row exists with `groupId: "grp_grokbot_war_room"`.

- [ ] **Step 2: Run seed script and verify in database**
  - Execute `docker cp scripts/seed-war-room-group.ts rakazo-worker-1:/app/scripts/seed-war-room-group.ts && docker exec rakazo-worker-1 npx tsx /app/scripts/seed-war-room-group.ts`
  - Verify row count in `chat_group_members`.

- [ ] **Step 3: Write and run `scripts/test-group-chat-mention.ts`**
  - Test `@TrendScout` mention in the group thread: only TrendScout responds.
  - Test multi-bot delegation: `@ExecutiveChief please coordinate GrokCoder`.

- [ ] **Step 4: Commit Task 1 changes**
  - Git commit: `feat: implement multi-bot war room group chat`

---

### Task 2: E-Mail Drafts with 1-Click Approval (Human-in-the-Loop)

**Files:**
- Modify: `workspace/tools/google_assistant.py`
- Create: `scripts/test-email-approval.ts`
- Modify: `packages/adapters/src/smtp-email.ts` (if needed)

**Interfaces:**
- Produces: `google_assistant.py draft` command returning structured draft payload.
- Produces: Interactive approval card flow pausing the agent run at `waiting_approval`.

- [ ] **Step 1: Extend `google_assistant.py` with `draft` and `send` commands**
  - Add `draft` command: Takes `--to`, `--subject`, `--body`, validates parameters, saves draft to `workspace/notes/inbox/drafts.json` or prints JSON.
  - Add `send` command: Validates approval token or confirmation flag before actual transmission.

- [ ] **Step 2: Sync tool to sandbox and test CLI**
  - `python workspace/tools/google_assistant.py draft --to "alex@partners-corp.eu" --subject "Re: Q4 Roadmap" --body "Roadmap freigegeben."`
  - Verify JSON output and draft file creation.

- [ ] **Step 3: Test approval workflow with ExecutiveChief**
  - Send prompt to ExecutiveChief: "Entwerfe eine Antwort auf die Mail von Alex Lindner und bitte um Freigabe vor dem Absenden."
  - Verify that the bot presents the draft and creates an approval request.

- [ ] **Step 4: Commit Task 2 changes**
  - Git commit: `feat: implement email drafts with human-in-the-loop approval`

---

### Task 3: Second Brain Vault (Obsidian/Markdown Sync)

**Files:**
- Create: directory structure `workspace/notes/{daily,tasks,research,inbox}`
- Create: `workspace/notes/README.md`
- Create: `workspace/notes/tasks/roadmap.md`
- Modify: `workspace/tools/google_assistant.py` (auto-archive briefings to `workspace/notes/daily/`)

**Interfaces:**
- Produces: Standardized Obsidian-compatible second brain vault.
- Produces: Automatic daily notes logging.

- [ ] **Step 1: Scaffold directory structure and templates**
  - Create directories in `workspace/notes/`: `daily/`, `tasks/`, `research/`, `inbox/`.
  - Create `workspace/notes/tasks/roadmap.md` with Eisenhower quadrants and active sprint goals.

- [ ] **Step 2: Update `google_assistant.py` briefing to mirror to `workspace/notes/daily/`**
  - When `briefing` is generated, automatically write `workspace/notes/daily/YYYY-MM-DD-briefing.md` with YAML frontmatter.

- [ ] **Step 3: Sync to Docker sandbox and test auto-logging**
  - Verify `ls -la /home/rakazo/shared/notes/daily/` inside sandbox container.

- [ ] **Step 4: Commit Task 3 changes**
  - Git commit: `feat: scaffold second brain obsidian vault with automated daily notes`

---

### Task 4: Voice Notes & Spoken Audio-Briefing

**Files:**
- Create: `workspace/tools/voice_briefing.py`
- Test: `workspace/notes/audio/`

**Interfaces:**
- Produces: `voice_briefing.py` generating MP3 audio files from text or daily briefings.
- Produces: Audible audio files playable in UI.

- [ ] **Step 1: Implement `workspace/tools/voice_briefing.py`**
  - Check for Python TTS (edge-tts or offline SAPI/pyttsx/espeak).
  - Provide fallback using standard Python wav synthesis or clean edge-tts command.
  - Output `.mp3` / `.wav` file into `workspace/notes/audio/latest_briefing.wav`.

- [ ] **Step 2: Test audio synthesis on host and in container**
  - `python workspace/tools/voice_briefing.py "Guten Morgen Pascal! Hier ist dein tägliches Executive Briefing."`
  - Verify file exists and has nonzero bytes.

- [ ] **Step 3: Commit Task 4 changes**
  - Git commit: `feat: add voice briefing audio synthesis tool`

---

### Task 5: End-to-End Team Demonstration & Final Verification

- [ ] **Step 1: Run comprehensive verification script**
  - Trigger War Room multi-bot dialogue.
  - Confirm briefing generation, note logging, email draft approval, and audio voice file creation.
- [ ] **Step 2: Update user documentation & finalize checklist**
