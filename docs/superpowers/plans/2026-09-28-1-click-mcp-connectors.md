# 1-Click MCP Connectors Implementation Plan

> **Goal:** Bring Grok-Bot-style 1-Click MCP Connector Presets to BobBot for non-technical users, enabling instant zero-config activation of Workspace Files, Web Fetch, Second Brain Notes, and GitHub, while maintaining compatibility with Track B and the existing stack.

---

## 1. Architecture & Design

### 1.1 Preset Definitions (`apps/web/src/pages/mcp-presets.ts`)
We create a dedicated modular definition file containing the curated 1-Click Connectors:
- **`workspace-files`**:
  - Name: `Workspace Files`
  - Slug: `workspace-files`
  - Description: `Direkter Lese- und Schreibzugriff auf deinen synchronisierten Windows-Ordner (workspace/).`
  - Transport: `stdio`
  - Command: `npx`
  - Args: `["-y", "@modelcontextprotocol/server-filesystem", "/home/rakazo/shared"]`
- **`web-fetch`**:
  - Name: `Web-Recherche & Fetch`
  - Slug: `web-fetch`
  - Description: `Liest Webseiten & Online-Dokumente blitzschnell als Markdown aus (ohne Browser-Overhead).`
  - Transport: `stdio`
  - Command: `npx`
  - Args: `["-y", "@modelcontextprotocol/server-fetch"]`
- **`markdown-notes`**:
  - Name: `Markdown Second Brain`
  - Slug: `markdown-notes`
  - Description: `Verwaltet ein dauerhaftes Wissens- und Notizarchiv im Workspace (Obsidian-kompatibel).`
  - Transport: `stdio`
  - Command: `npx`
  - Args: `["-y", "@modelcontextprotocol/server-filesystem", "/home/rakazo/shared/notes"]`
- **`github`**:
  - Name: `GitHub Connect`
  - Slug: `github`
  - Description: `Code durchsuchen, Commits, Pull Requests und Issues erstellen.`
  - Transport: `stdio`
  - Command: `npx`
  - Args: `["-y", "@modelcontextprotocol/server-github"]`
  - Requires: `Personal Access Token` (simple 1-field modal)

### 1.2 Preset Gallery UI (`apps/web/src/pages/McpServersOverlay.tsx`)
- Placed directly at the top of `McpServersOverlay`, before the manual server form.
- Rendered as a responsive 2x2 grid of modern cards with clean Lucide icons (`FolderKanban`, `Globe`, `BookOpen`, `GitBranch`).
- Each card has:
  - Header with icon + title + badge (`Beliebt`, `Empfohlen`).
  - Plain-text non-technical description.
  - Action button:
    - If already installed: Green checkmark `Aktiviert` + `Trennen` button.
    - If not installed: `1-Klick Aktivieren` button.
- Activating a preset automatically assigns **all active bots** (`ExecutiveChief`, `OpenResearch`, `GrokCoder`, `TrendScout`, `DataAnalyst`) so the user does not need to configure checkboxes manually.
- The manual expert form (stdio/http/headers) remains below under a collapsible `<details>` or secondary card for advanced developers.

---

## 2. Proposed Changes

### `apps/web/src/pages/mcp-presets.ts`
- Create file with typescript interfaces for `McpPreset`.
- Export `MCP_PRESETS` list with standard configurations.

### `apps/web/src/pages/McpServersOverlay.tsx`
- Import `MCP_PRESETS`.
- Add `installPreset(preset, customEnv?)` handler:
  1. Call `rpc.mcp.servers.create(...)`.
  2. Call `rpc.mcp.assignments.replace(...)` for all active bots with `allowAllTools: true`.
  3. Call `refresh()` to update server cards.
- Add `uninstallPreset(preset)` handler:
  1. Find matching server by slug.
  2. Call `rpc.mcp.servers.remove({ id })`.
  3. Call `refresh()`.
- Add state for GitHub token dialog if user clicks GitHub card.
- Insert the preset gallery at the top of the dialog content.

---

## 3. Verification & Testing

### 3.1 Static Checks
- `pnpm --filter @rakazo/web check` (TypeScript verification)
- `pnpm --filter @rakazo/web lint` (Biome formatting and lint)

### 3.2 Live End-to-End Verification
1. Open Web UI at `http://127.0.0.1:5174`.
2. Click `Integrations` -> `MCP Servers`.
3. Verify that the 4 preset cards are clearly visible at the top.
4. Click `1-Klick Aktivieren` on `Workspace Files`.
5. Verify card status switches to `Aktiviert`.
6. Inspect Postgres table `mcp_servers` and `bot_mcp_servers` to verify server creation and assignment to all 5 bots.
