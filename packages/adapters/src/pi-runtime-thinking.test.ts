import { describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  deltas: [] as Array<{ type: string; delta: string }>,
}));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    state = { errorMessage: undefined as string | undefined, messages: [] as unknown[] };
    private readonly listeners: Array<(event: Record<string, unknown>) => void> = [];

    subscribe(listener: (event: Record<string, unknown>) => void) {
      this.listeners.push(listener);
    }

    async prompt() {
      for (const delta of fake.deltas) {
        this.emit({ type: "message_update", assistantMessageEvent: delta });
      }
      this.emit({
        type: "turn_end",
        message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
        toolResults: [],
      });
      this.emit({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
      });
    }

    followUp() {}
    abort() {}
    async waitForIdle() {}

    private emit(event: Record<string, unknown>) {
      for (const listener of this.listeners) listener(event);
    }
  },
}));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinModels: () => ({
    getModel: (_provider: string, modelId: string) =>
      modelId === "thinking-test-model" ? { provider: "test", id: modelId } : undefined,
    streamSimple: () => {
      throw new Error("the fake agent must not call a provider");
    },
  }),
}));

vi.mock("./pi-local-provider.js", () => ({
  registerLocalProvider: (models: unknown) => models,
}));

vi.mock("./pi-openai-compatible-provider.js", () => ({
  OPENAI_COMPATIBLE_PROVIDER_ID: "openai-compatible",
  registerOpenAiCompatibleCatalog: (models: unknown) => models,
  registerOpenAiCompatibleRuntime: (models: unknown) => models,
}));

import { PiAgentRuntime } from "./pi-runtime.js";

async function collectDeltas(deltas: Array<{ type: string; delta: string }>) {
  fake.deltas = deltas;
  const events: Array<{ type: string; text?: string }> = [];
  const runtime = new PiAgentRuntime();
  for await (const event of runtime.run(
    {
      botId: "b",
      threadId: "t",
      runId: "r",
      prompt: "go",
      instructions: "",
      history: [],
      tools: [],
      model: { provider: "test", id: "thinking-test-model" },
    },
    { signal: new AbortController().signal },
  )) {
    events.push(event as { type: string; text?: string });
  }
  return events;
}

describe("Pi thinking stream", () => {
  it("surfaces a thinking delta as a thinking event, not as text", async () => {
    const events = await collectDeltas([
      { type: "thinking_delta", delta: "hmm" },
      { type: "text_delta", delta: "Done." },
    ]);
    expect(events).toContainEqual({ type: "thinking", text: "hmm" });
    expect(events.filter((event) => event.type === "text")).toHaveLength(1);
  });
});
