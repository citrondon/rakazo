# PWA Standalone Mode & Deep Research Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Rakazo into a installable standalone PWA app (no browser borders/bars) on Windows & Mobile, and establish a Deep Research workflow where OpenResearch & TrendScout bots scrape web resources via the `web-fetch` MCP connector and output structured markdown reports directly into the synced workspace.

**Architecture:**
1. **PWA Standalone Engine:** Register a clean service worker (`sw.js`) in `apps/web` with offline cache handling, update `site.webmanifest` with display mode, scope, orientation, and categories, and add an in-app "Als Desktop-App installieren" trigger button in `SettingsOverlay` / `Shell`.
2. **Deep Research & Web-Fetch Workflow:** Equip `OpenResearch` and `TrendScout` with a specialized Research Protocol prompt, test live URL extraction via `@modelcontextprotocol/server-fetch`, and format outputs to `/home/rakazo/shared/research/<topic>.md` with live syncing to Windows `workspace/research/`.

**Tech Stack:** React 19, Vite 8, PWA Web Manifest, Service Worker API, Lingui i18n, Model Context Protocol (`@modelcontextprotocol/server-fetch`), Docker Compose, SpooK Proxy.

---

## Global Constraints
- Preserve existing Track B Bot Import, Budgeting, and i18n catalog synchronization rules.
- Do not read or output secrets (follow SECRETS-POLICY).
- All new user-facing strings must support Lingui i18n (`<Trans>`, `t`).
- Live-sync daemon (`scripts/sync-workspace.ps1`) must automatically mirror research reports to host `workspace/`.

---

## Part 1: PWA Standalone App

### Task 1: Enhance `site.webmanifest` and Service Worker Registration
**Files:**
- Modify: `apps/web/public/site.webmanifest`
- Create: `apps/web/public/sw.js`
- Modify: `apps/web/src/main.tsx` or `apps/web/index.html`

- [x] **Step 1: Update `site.webmanifest`**
Add `scope`, `id`, `orientation`, `categories`, and `prefer_related_applications: false`:
```json
{
  "name": "Rakazo",
  "short_name": "Rakazo",
  "description": "Your team of always-on AI agents.",
  "start_url": "/",
  "scope": "/",
  "id": "com.rakazo.app",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#0b0c0e",
  "theme_color": "#0b0c0e",
  "categories": ["productivity", "utilities"],
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [x] **Step 2: Create `apps/web/public/sw.js`**
Provide minimal service worker required by Chrome/Edge to qualify for native install:
```javascript
const CACHE_NAME = "rakazo-pwa-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Let network handle dynamic requests, fallback to fetch
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
```

- [x] **Step 3: Register Service Worker in `apps/web/src/main.tsx`**
Register the service worker safely in production:
```typescript
if ("serviceWorker" in navigator && !import.meta.env.DEV) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
```

- [x] **Step 4: Add Install Prompt Hook & Button**
Create `apps/web/src/lib/use-pwa-install.ts` listening to `beforeinstallprompt` event, allowing the user to click "Rakazo als App installieren" directly from settings or sidebar.

- [x] **Step 5: Typecheck & Build**
Run: `pnpm --filter @rakazo/web check` and `pnpm --filter @rakazo/web build`

---

## Part 2: Deep Research & Web-Fetch Workflow

### Task 2: Configure OpenResearch & TrendScout for Live Web-Fetch
**Files:**
- Database: Verify bot prompts and MCP assignment for `OpenResearch` (local database id) and `TrendScout` (local database id)
- Create: `apps/web/src/pages/mcp-presets.ts` (ensure `web-fetch` provides URL scrape tools)
- Target Directory: `/data/homes/team-<space-id>/shared/research/`

- [x] **Step 1: Test `web-fetch` MCP Server Tool**
Verify that `@modelcontextprotocol/server-fetch` successfully resolves external URLs (e.g. `https://news.ycombinator.com` or GitHub READMEs) through the bot execution loop.

- [x] **Step 2: Set up Research Team Chat Group**
Create or use a Group Chat: **"Research & Intelligence"** containing:
1. **OpenResearch** (Autonomous research, paper & docs scraping, deep analysis)
2. **TrendScout** (Trend identification, synthesis, bullet-point summaries)
3. **Chief** (Reviewer & Coordinator)

- [x] **Step 3: Run Live Deep Research Query**
Send a live research task:
`"@OpenResearch recherchiere bitte die neuesten Trends zu Open-Source MCP Servern unter https://github.com/punkpeye/awesome-mcp-servers und fasse die 5 wichtigsten Kategorien zusammen. Speichere das Ergebnis als 'research/mcp-trends.md' im gemeinsamen Workspace."`

- [x] **Step 4: Verify Host Workspace Sync**
Verify that `pnpm workspace:pull` detects the new file and writes it to the configured local workspace folder with complete analysis content.

---

## Verification Checklist
- [x] Chrome / Edge shows the "Install Rakazo" app icon in the address bar.
- [x] Launching Rakazo in standalone window opens without URL bar or browser tabs.
- [x] `web-fetch` tool successfully fetches and digests live web content.
- [x] Markdown reports are saved in `/home/rakazo/shared/research/` and synced to Windows host.
