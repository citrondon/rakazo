# Thinking Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a client opt in to seeing a bot's reasoning ("thinking") inline in a thread, without changing what the model is asked to do and without leaking thinking into every install.

**Architecture:** The provider runtime (`@earendil-works/pi-ai`) already emits thinking as first-class stream events. Three seams currently drop it: our adapter never reads the `thinking_delta` branch, the runtime-event contract (`AgentRuntimeEvent`) and the thread `MessageBlock` union have no thinking member, and there is no client preference. We thread a `thinking` block through the existing live-progress pipeline (same path as `thread.progress`), and gate rendering behind a client-local, off-by-default preference that mirrors `tool-activity-preference`.

**Tech Stack:** TypeScript (strict), pnpm workspace, Zod contracts, Vitest, React 19 + Tailwind 4 (web), Pi runtime adapter, oRPC thread events.

---

## Preconditions

- **Product gate (Task 0) must be approved by the maintainer before any code lands.** This changes a deliberate product stance: the system prompt already tells bots "Thinking stays private."
- Branch off `origin/main`. Do not build on top of unrelated local commits.

## Scope

In scope: web + Electron (hosts the web UI). Out of scope: Expo mobile rendering (Task 8 records the explicit decision). No provider-side changes — we only read what pi-ai already streams.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/adapter-kit/src/types.ts` | Add `thinking` to the `AgentRuntimeEvent` union |
| `packages/adapters/src/pi-runtime.ts` | Read `thinking_delta` and emit a `thinking` runtime event |
| `packages/contracts/src/events.ts` | Add `"thread.thinking"` product event + `thinking` `MessageBlock` kind |
| `packages/core/src/events.ts` | Reduce `thread.thinking` into a live `thinking` block |
| `packages/adapters/src/executor.ts` | Map the runtime `thinking` event to a persisted `thread.thinking` append |
| `apps/web/src/lib/thinking-preference.ts` | Client-local on/off preference, default off |
| `apps/web/src/components/ThinkingDisclosure.tsx` | Renders a `thinking` block as a collapsed disclosure |
| `apps/web/src/pages/AccountSettingsOverlay.tsx` | The Advanced switch |
| `apps/web/src/pages/Shell.tsx` | Consumes the preference, passes it to the thread renderer |
| `docs/thinking-visibility.md` | Behavior, platform scope, tests (mirror `docs/tool-activity.md`) |

---

## Task 0: Product decision (blocking)

**Files:**
- Modify: `packages/adapters/src/executor.ts:5298` (the prompt string)

- [ ] **Step 1: Get the maintainer's explicit approval** that a bot's thinking may be *displayed to the user who asked*, opt-in. Do not proceed without it. If declined, this plan is killed and Task 7 records the decision under "Not doing".

- [ ] **Step 2: Update the prompt line** if the stance changes. Line 5298 currently contains `"Do not narrate every tool call. Thinking stays private. message_user is capped at 500 characters ..."`. Replace `Thinking stays private.` with wording true whether or not the view is on:

```
The user may turn on a view of your reasoning; do not address it, repeat it in replies, or rely on it to carry the answer.
```

- [ ] **Step 3: Commit**

```bash
git add packages/adapters/src/executor.ts
git commit -m "docs(adapters): stop telling bots their thinking is always private"
```

---

## Task 1: Runtime event vocabulary

**Files:**
- Modify: `packages/adapter-kit/src/types.ts:480-516`
- Test: `packages/adapter-kit/src/types.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { AgentRuntimeEvent } from "./types.js";

describe("AgentRuntimeEvent", () => {
  it("carries an opt-in thinking delta distinct from user-visible text", () => {
    const event: AgentRuntimeEvent = { type: "thinking", text: "weighing options" };
    expect(event.type).toBe("thinking");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/adapter-kit/src/types.test.ts`
Expected: FAIL — `thinking` is not assignable to `AgentRuntimeEvent`.

- [ ] **Step 3: Add the union member** in `packages/adapter-kit/src/types.ts`, right after `{ type: "text"; text: string }` (line 481):

```ts
  /** Model reasoning, when the provider exposes it. Never merged into `text`. */
  | { type: "thinking"; text: string }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/adapter-kit/src/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-kit/src/types.ts packages/adapter-kit/src/types.test.ts
git commit -m "feat(adapter-kit): add a thinking runtime event"
```

---

## Task 2: Adapter reads thinking deltas

**Files:**
- Modify: `packages/adapters/src/pi-runtime.ts:368-381` (main loop) and `:1208-1211` (subagent loop)
- Test: `packages/adapters/src/pi-runtime-thinking.test.ts` (create)

- [ ] **Step 1: Write the failing test**, reusing the mock style from `pi-runtime-tool-dispatch.test.ts` (a mocked `streamSimple` on a `MessageUpdate` carrying a `thinking_delta`):

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinModels: () => ({
    "test-model": { id: "test-model", provider: "test", api: "openai", reasoning: true },
  }),
}));

it("surfaces a thinking delta as a thinking event, not as text", async () => {
  // inner stream order: thinking_delta "hmm" -> text_delta "Done."
  const events = await collect(runtime, request);
  expect(events).toContainEqual({ type: "thinking", text: "hmm" });
  expect(events.filter((e) => e.type === "text")).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/adapters/src/pi-runtime-thinking.test.ts`
Expected: FAIL — no `thinking` event is emitted.

- [ ] **Step 3: Add the branch in the main loop.** In `packages/adapters/src/pi-runtime.ts`, after the `text_delta` block that ends at line 381 (`queue.push({ type: "text", text: delta });`), add:

```ts
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent.type === "thinking_delta"
          ) {
            const delta = event.assistantMessageEvent.delta;
            // Redacted thinking arrives empty; skip so the block stays honest.
            if (delta) queue.push({ type: "thinking", text: delta });
          }
```

- [ ] **Step 4: Add the same branch in the subagent loop** (after line 1211) — subagent reasoning is the subagent's own.

- [ ] **Step 5: Run the adapter tests**

Run: `pnpm exec vitest run packages/adapters/src/pi-runtime-thinking.test.ts packages/adapters/src/pi-runtime-tool-dispatch.test.ts`
Expected: PASS, existing suite still green.

- [ ] **Step 6: Commit**

```bash
git add packages/adapters/src/pi-runtime.ts packages/adapters/src/pi-runtime-thinking.test.ts
git commit -m "feat(adapters): read thinking deltas from the provider stream"
```

---

## Task 3: Wire contract — event type and block kind

**Files:**
- Modify: `packages/contracts/src/events.ts:9-19` (ProductEventType) and `:96` (MessageBlock union)
- Test: `packages/contracts/src/index.test.ts` (extend)

- [ ] **Step 1: Write the failing test** in `packages/contracts/src/index.test.ts`:

```ts
it("carries a thinking block and the thread.thinking event", () => {
  expect(MessageBlock.parse({ kind: "thinking", text: "weighing options" })).toEqual({
    kind: "thinking",
    text: "weighing options",
  });
  expect(ProductEventType.options).toContain("thread.thinking");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/contracts/src/index.test.ts`
Expected: FAIL — `thinking` is not a valid discriminant.

- [ ] **Step 3: Add the event type** to the `ProductEventType` enum list in `packages/contracts/src/events.ts` (after `"thread.progress"`, line 12):

```ts
  "thread.thinking",
```

- [ ] **Step 4: Add the block kind** to the `MessageBlock` union (after the `progress` object, before `steps`):

```ts
  z.object({
    /** Model reasoning, shown only when the viewer opted in. Never the answer. */
    kind: z.literal("thinking"),
    text: z.string(),
  }),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run packages/contracts/src/index.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/events.ts packages/contracts/src/index.test.ts
git commit -m "feat(contracts): add a thinking message block and thread event"
```

---

## Task 4: Client reducer folds thinking into the live message

**Files:**
- Modify: `packages/core/src/events.ts:239-245` (LiveMessageUpdate + reduceLiveMessageBlocks)
- Test: `packages/core/src/events.test.ts` (extend)

- [ ] **Step 1: Write the failing test** in `packages/core/src/events.test.ts`:

```ts
it("appends a thinking block from a thread.thinking event and merges consecutive deltas", () => {
  const first = reduceLiveMessageBlocks([], { type: "thinking", payload: { delta: "hmm" } });
  expect(first).toEqual([{ kind: "thinking", text: "hmm" }]);
  const merged = reduceLiveMessageBlocks(first, { type: "thinking", payload: { delta: ", okay" } });
  expect(merged).toEqual([{ kind: "thinking", text: "hmm, okay" }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/events.test.ts`
Expected: FAIL — `thinking` is not a known update type.

- [ ] **Step 3: Extend the update union** in `packages/core/src/events.ts:239`:

```ts
export type LiveMessageUpdate =
  | { type: "progress"; payload: Record<string, unknown> | undefined }
  | { type: "thinking"; payload: Record<string, unknown> | undefined }
  | { type: "tool"; name: string };
```

- [ ] **Step 4: Merge thinking deltas** in `reduceLiveMessageBlocks` — add a branch that, when `update.type === "thinking"`, appends the `delta` to a trailing `thinking` block or starts a new one, mirroring how `appendTextSegment` (line 326) merges `text`:

```ts
  if (update.type === "thinking") {
    const delta = typeof update.payload?.delta === "string" ? update.payload.delta : "";
    if (!delta) return [...blocks];
    const tail = blocks.at(-1);
    return tail?.kind === "thinking"
      ? [...blocks.slice(0, -1), { kind: "thinking", text: tail.text + delta }]
      : [...blocks, { kind: "thinking", text: delta }];
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/events.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/events.ts packages/core/src/events.test.ts
git commit -m "feat(core): reduce thinking deltas into a live block"
```

---

## Task 5: Executor maps the runtime event onto the thread stream

**Files:**
- Modify: `packages/adapters/src/executor.ts:4324-4345` (the `text`/`progress` mapping)
- Test: `packages/adapters/src/executor-thinking.test.ts` (create)

- [ ] **Step 1: Write the failing test** driving a scripted runtime that emits `{ type: "thinking", text: "hmm" }` and asserting a `thread.thinking` append:

```ts
it("appends thread.thinking for a runtime thinking event", async () => {
  const appended: Array<{ type: string; payload: unknown }> = [];
  // wire deps.events.append to push into `appended` as the other executor tests do
  await run(...);
  expect(appended).toContainEqual(
    expect.objectContaining({ type: "thread.thinking", payload: expect.objectContaining({ delta: "hmm" }) }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/adapters/src/executor-thinking.test.ts`
Expected: FAIL — no `thread.thinking` event is appended.

- [ ] **Step 3: Add the branch** in `packages/adapters/src/executor.ts`, right after the `event.type === "text"` block (line 4334) and before `else if (event.type === "progress")`:

```ts
            } else if (event.type === "thinking") {
              // Thinking is streamed but never merged into `assembled`/text segments,
              // so it can never leak into the bot's reply or the final answer.
              await deps.events.append({
                spaceId: run.spaceId,
                threadId: thread.id,
                botId: bot.id,
                type: "thread.thinking",
                runId,
                payload: { delta: event.text, streaming: true },
              });
            } else if (event.type === "progress") {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/adapters/src/executor-thinking.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/src/executor.ts packages/adapters/src/executor-thinking.test.ts
git commit -m "feat(adapters): stream thinking as a thread event"
```

---

## Task 6: Transport and replay round-trip

**Files:**
- Verify: the SSE/event forwarder that relays product events to the client
- Test: extend an existing thread-event integration/round-trip test

- [ ] **Step 1: Confirm the forwarder is generic.** Find where product events are read (search `ProductEventType` consumers in `apps/api/src`) and check whether `thread.thinking` is relayed without a per-type allowlist. If there *is* an allowlist, add `"thread.thinking"` to it.

- [ ] **Step 2: Write the failing test** — a replay test that stores a `thread.thinking` event and asserts the client sees a `thinking` block via `reduceLiveMessageBlocks` after reload:

```ts
it("replays a stored thinking block into the live message", () => {
  const blocks = applyThreadEvent([], { type: "thread.thinking", payload: { delta: "hmm" } });
  expect(blocks).toEqual([{ kind: "thinking", text: "hmm" }]);
});
```

- [ ] **Step 3: Run it, expect FAIL, then enable the path** (allowlist or reducer wiring) and re-run.

Run: `pnpm exec vitest run <the round-trip test file>`
Expected: FAIL, then PASS after wiring.

- [ ] **Step 4: Guard the persistence schema.** If stored messages are validated on read, a stored `thinking` block must not fail validation on an older client. Confirm `MessageBlock` already tolerates it (Task 3) and note the compatibility in `docs/thinking-visibility.md` (Task 7).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): relay and replay the thinking block"
```

---

## Task 7: Client preference, control, and renderer

**Files:**
- Create: `apps/web/src/lib/thinking-preference.ts`, `apps/web/src/lib/thinking-preference.test.ts`
- Create: `apps/web/src/components/ThinkingDisclosure.tsx`, `apps/web/src/components/ThinkingDisclosure.test.tsx`
- Modify: `apps/web/src/pages/AccountSettingsOverlay.tsx:66-70,205-230`
- Modify: `apps/web/src/pages/Shell.tsx:229,440-445`
- Create: `docs/thinking-visibility.md`

- [ ] **Step 1: Write the failing preference test** — copy the shape of `tool-activity-preference.test.ts` for a new key `rakazo.showThinking`, default off, only a saved `"on"` enabling.

```ts
import { describe, expect, it } from "vitest";
import { normalizeThinkingPreference, thinkingEnabled } from "./thinking-preference.js";

describe("thinking preference", () => {
  it("stays off unless a stored 'on' is present", () => {
    expect(normalizeThinkingPreference(undefined)).toBe("off");
    expect(normalizeThinkingPreference("off")).toBe("off");
    expect(normalizeThinkingPreference("ON")).toBe("on");
    expect(thinkingEnabled(normalizeThinkingPreference(null))).toBe(false);
  });
});
```

- [ ] **Step 2: Create `apps/web/src/lib/thinking-preference.ts`** by copying `tool-activity-preference.ts` and renaming: `ToolActivityPreference`→`ThinkingPreference`, `TOOL_ACTIVITY_STORAGE_KEY`→`THINKING_STORAGE_KEY = "rakazo.showThinking"`, and the exported function names to `normalizeThinkingPreference`, `thinkingEnabled`, `resolveThinkingPreference`, `getThinkingPreference`, `getThinkingEnabled`, `setThinkingPreference`, `subscribeThinking`. Keep the exact same storage/notify semantics.

- [ ] **Step 3: Run the test**

Run: `pnpm exec vitest run apps/web/src/lib/thinking-preference.test.ts`
Expected: PASS

- [ ] **Step 4: Write the failing renderer test** — mirror `ToolActivityDisclosure.test.tsx`: a `thinking` block with `viewerThinkingEnabled=false` renders nothing; with `true` renders a collapsed disclosure whose summary shows a fixed label and expanding reveals the text.

- [ ] **Step 5: Create `apps/web/src/components/ThinkingDisclosure.tsx`** modeled on `ToolActivityDisclosure.tsx`: a `<details>`/`<summary>` disclosure, monochrome, `text-muted-foreground`, no new colors, label via `<Trans>Thinking</Trans>`, body `whitespace-pre-wrap`. It returns `null` when there is no `thinking` block.

- [ ] **Step 6: Run the test**

Run: `pnpm exec vitest run apps/web/src/components/ThinkingDisclosure.test.tsx`
Expected: PASS

- [ ] **Step 7: Add the switch** in `AccountSettingsOverlay.tsx`, directly after the "Show tool activity" block (line ~227): state `showThinking` from `getThinkingPreference() === "on"`, a `Switch` with `data-testid="thinking-toggle"`, and a `<Trans>Show thinking</Trans>` label, calling `setThinkingPreference(checked ? "on" : "off")`.

- [ ] **Step 8: Wire the thread** in `Shell.tsx` (next to the `tool-activity-preference` imports at line 229 and the `useSyncExternalStore` binding at 443): subscribe to `thinking`, read `getThinkingEnabled`, and render `ThinkingDisclosure` for `thinking` blocks only when enabled. When disabled, `thinking` blocks are filtered out before rendering (they must never fall through a default branch).

- [ ] **Step 9: Write `docs/thinking-visibility.md`**, mirroring `docs/tool-activity.md`: behavior (off by default, stored per browser/desktop install, not synced), the platform-scope table (Web supported, Electron supported, Mobile → see Task 8), the redaction/degradation note (empty thinking is skipped; providers that omit or summarize thinking simply show less), and the tests list.

- [ ] **Step 10: Refresh i18n catalogs** (CI runs `pnpm --filter @rakazo/web intl:check`):

```bash
pnpm --filter @rakazo/web intl:extract
pnpm --filter @rakazo/web intl:compile
```

Add German translations for `Thinking` and `Show thinking` in `apps/web/scripts/translations-de.json`, then re-run `intl:extract`/`intl:compile` so `locales/*.po` match.

- [ ] **Step 11: Run the web suite and commit**

Run: `pnpm --filter @rakazo/web test`
Expected: PASS (68+ files).

```bash
git add apps/web/src/lib/thinking-preference.ts apps/web/src/lib/thinking-preference.test.ts \
  apps/web/src/components/ThinkingDisclosure.tsx apps/web/src/components/ThinkingDisclosure.test.tsx \
  apps/web/src/pages/AccountSettingsOverlay.tsx apps/web/src/pages/Shell.tsx \
  docs/thinking-visibility.md apps/web/src/locales apps/web/scripts/translations-de.json
git commit -m "feat(web): opt-in thinking view in Advanced settings"
```

---

## Task 8: Mobile decision and safe degradation

**Files:**
- Modify: `apps/mobile/app/thread.tsx` (only if unknown blocks are unsafe)
- Modify: `docs/thinking-visibility.md`

- [ ] **Step 1: Prove mobile is safe.** Inspect how mobile renders blocks (search the block switch in `apps/mobile`). A `thinking` block must not crash or render raw JSON.

- [ ] **Step 2: If mobile renders unknown blocks unsafely**, add an explicit `thinking` case that renders nothing.

- [ ] **Step 3: Record the decision** in the platform-scope table: either "Mobile hides thinking (previous behavior, nothing changes)" or "Mobile renders it" — pick one and say why.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile docs/thinking-visibility.md
git commit -m "docs(mobile): record thinking view scope"
```

---

## Effort and risk

| Task | Effort | Risk | Why |
| --- | --- | --- | --- |
| 0 Product decision | S (a conversation) | **High — blocking** | Reverses a deliberate stance ("Thinking stays private"); needs maintainer sign-off and a prompt/copy change. |
| 1 Runtime vocabulary | S | Low | One union member; TypeScript exhaustiveness is the guard. |
| 2 Adapter branches | S | Low–Med | Provider variance: some models never emit `thinking_delta`; redacted thinking arrives empty and must be skipped. |
| 3 Contract | S | Med | A new block that older clients may not know — must degrade, not throw. |
| 4 Core reducer | S | Low | Mirrors the existing `text` merge. |
| 5 Executor mapping | S | **Med** | Must never merge thinking into `assembled`/text, or thinking leaks into the reply/final answer. Covered by a test. |
| 6 Transport/replay | M | Med | Verify the forwarder isn't allowlisted; validate stored-message compatibility. |
| 7 UI + docs + i18n | **L** | Med | The bulk of the work; `intl:check` in CI fails if catalogs drift. |
| 8 Mobile | S | Low | Decide and, at most, add a no-op case. |

**Risks called out (from the spike):**
- **Not every provider emits thinking.** Anthropic can return `thinkingDisplay: "omitted"` (empty) or a *summary*; OpenAI-compatible servers may send `reasoning_content` or nothing. The view must show less, never break.
- **Redacted/safety-filtered thinking** arrives as an empty `thinking` with only `thinkingSignature` — skip it.
- **Cost/latency:** capturing thinking costs tokens and, on providers where `omitted` is the fast path, latency. The feature stays opt-in and read-only; it does not change what is requested *except* if Task 0's decision requires requesting thinking — then revisit `thinkingDisplay`.
- **Billing already correct:** reasoning tokens are already inside `outputTokens`; no receipt change is needed.

## Rollback

Each task is one commit. Revert in reverse order. Tasks 1–6 are inert without Task 7's preference (nothing renders), so a partial rollback to "pipeline only, no UI" is safe.

## Self-review

- **Spec coverage:** provider read (T1–2), wire contract (T3–4), transport/replay (T5–6), opt-in UI + docs (T7), other surfaces (T8), product gate (T0). No requirement left unmapped.
- **Placeholder scan:** the two intentionally generic bits are Task 6's "the round-trip test file" and the executor test's `run(...)` harness, both because they must be matched to the file's existing harness on read; every other step ships exact code.
- **Type consistency:** the runtime event is `thinking` end to end (`AgentRuntimeEvent` → pi-runtime `queue.push` → executor branch), the wire event is `thread.thinking`, the block kind is `thinking` with a `text` field, and the preference key is `rakazo.showThinking` with names `normalizeThinkingPreference`/`thinkingEnabled`/`setThinkingPreference`/`subscribeThinking`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-01-thinking-visibility.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session with checkpoints for review.

Do **not** start Task 1 before Task 0 is approved.