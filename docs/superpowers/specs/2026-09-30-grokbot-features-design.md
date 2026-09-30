# Architectural Design: GrokBot Core Features for Rakazo

- **Date:** 2026-09-30
- **Status:** Approved
- **Scope:** 4 High-Impact GrokBot Features (Group Chat, Email Approvals, Second Brain, Voice Notes)

---

## 1. Feature Overview & Objectives

GrokBot (launched August 2026 by xAI/Cursor) introduced an always-on AI teammate model characterized by:
1. Shared persistent computer & multi-bot teams.
2. Group chats where specialists hand off work to each other.
3. Human-in-the-loop approval gates before irreversible actions.
4. Second brain notes vault continuously maintained by bots.
5. Voice notes & spoken briefings.

This design document establishes the concrete technical implementation of these capabilities in Rakazo.

---

## 2. Feature 1: Multi-Bot Group Chat (Team War Room)

### 2.1 Concept & Architecture
- **Data Model:** Extends existing `chat_groups` and `chat_group_members` in PostgreSQL.
- **Roster:**
  - `ExecutiveChief` (Coordinator / Lead)
  - `GrokCoder` (Software Engineering & Tooling)
  - `TrendScout` (Tech Radar & Social Monitoring)
  - `DataAnalyst` (Data Science & Budgeting)
- **Turn-Taking & Routing:**
  - **Explicit Mentions (`@BotName`):** Regex `/^@(\w+)/i` parses the target bot. Only the mentioned bot processes the turn.
  - **Team Delegation (Multi-Mention / Unmentioned):** If no mention is given or multiple bots are addressed, `ExecutiveChief` acts as orchestrator:
    1. Evaluates user request.
    2. Issues sub-prompts to specialized team members.
    3. Aggregates results into an executive summary in the group thread.

### 2.2 API & Seed Script
- Script: `scripts/seed-war-room-group.ts`
  - Ensures a group named `"GrokBot Team War Room"` exists with all 4 bots enrolled as members.
  - Links to a dedicated group thread `threadId`.

---

## 3. Feature 2: E-Mail Drafts with 1-Click Approval (Human-in-the-Loop)

### 3.1 Concept & Architecture
- **Safety Boundary:** Destructive or external communication actions (sending emails, purging inbox) MUST NOT execute without explicit human approval.
- **Approval Flow:**
  1. The bot analyzes unread emails via `workspace/tools/google_assistant.py mail`.
  2. For any email requiring a response, the bot generates a structured draft:
     - `to`: recipient email
     - `subject`: email subject line
     - `body`: proposed reply text
     - `action`: `send` | `archive` | `delete`
  3. The bot presents this draft via Rakazo's native `ApprovalEffect` / `waiting_approval` state.
  4. The UI displays an interactive action card with `[Freigeben & Senden]` and `[Abbrechen]`.
  5. Only upon receiving confirmation does the executor invoke `python3 workspace/tools/google_assistant.py send`.

---

## 4. Feature 3: Second Brain Vault (Obsidian/Markdown Sync)

### 4.1 Concept & Architecture
- **Location:** `workspace/notes/` (mapped to `/home/rakazo/shared/notes` in Docker).
- **Directory Structure:**
  - `daily/`: Daily executive briefings (`YYYY-MM-DD-briefing.md`)
  - `tasks/`: Living project roadmaps and backlog (`roadmap.md`, `sprint-backlog.md`)
  - `research/`: Structured research reports from TrendScout & OpenResearch (`ai-trends-*.md`)
  - `inbox/`: Triage records of processed communications
- **Standards:**
  - Standard GitHub Flavored Markdown with YAML Frontmatter:
    ```markdown
    ---
    date: 2026-09-30
    author: ExecutiveChief
    tags: [briefing, q4-roadmap]
    ---
    ```
  - Wikilinks for cross-referencing: `[[2026-09-30-briefing]]`
  - Fully compatible with Obsidian, VS Code, and terminal tools.

---

## 5. Feature 4: Voice Notes & Audio-Briefing

### 5.1 Concept & Architecture
- **Audio Generation:**
  - A lightweight generator script `workspace/tools/voice_briefing.py` utilizing Microsoft Edge-TTS (or Python standard TTS synthesis) to output crystal-clear German speech (`de-DE-ConradNeural` or `de-DE-KatjaNeural`).
  - Generates `.mp3` audio files saved directly into `workspace/notes/audio/`.
- **Playback:**
  - The generated audio path is linked in the bot's chat response so the user can play it with one click in the web UI, on mobile, or in any media player.

---

## 6. Implementation Phases & Verification Strategy

1. **Phase 1: Multi-Bot Group Chat Setup**
   - Seed the "GrokBot Team War Room" group with all 4 bots.
   - Verify group chat message routing, `@mention` dispatching, and bot-to-bot handoffs.
2. **Phase 2: E-Mail Draft & Approval Tooling**
   - Extend `google_assistant.py` with `draft` and `send` commands.
   - Wire approval test and verify approval cards in Rakazo.
3. **Phase 3: Second Brain Vault Initialization**
   - Scaffold the `workspace/notes/` directory hierarchy.
   - Instruct ExecutiveChief and TrendScout to automatically mirror daily briefings into `notes/daily/`.
4. **Phase 4: Voice Briefing Generator**
   - Implement `voice_briefing.py` for automated audio synthesis.
   - Test audio file generation and verify playback.
