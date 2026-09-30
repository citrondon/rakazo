import type { RunReceipt } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { receiptLines } from "./run-receipt";

function receipt(overrides: Partial<RunReceipt> = {}): RunReceipt {
  return {
    runId: "run-1",
    botId: "bot-1",
    botName: "Researcher",
    threadId: "thread-1",
    trigger: "user",
    status: "completed",
    modelProvider: "openrouter",
    modelId: "openai/gpt-5.6-luna",
    startedAt: null,
    completedAt: null,
    durationMs: null,
    tokens: null,
    tools: [],
    toolCalls: 0,
    effects: [],
    artifacts: [],
    approvals: [],
    stopReason: null,
    ...overrides,
  };
}

const tokens = (total: number, input: number, output: number) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: total - input - output,
  cacheWriteTokens: 0,
  totalTokens: total,
});

describe("receiptLines", () => {
  it("leads with the stop reason so a refused run explains itself first", () => {
    const lines = receiptLines(
      receipt({
        status: "failed",
        stopReason: "Monthly token budget exhausted for this bot.",
      }),
    );
    expect(lines[0]).toBe("Monthly token budget exhausted for this bot.");
    // A run that never reached a model call has no numbers to invent.
    expect(lines).toEqual(["Monthly token budget exhausted for this bot.", "Tokens: —"]);
  });

  it("describes a completed run with the rows it stored", () => {
    const lines = receiptLines(
      receipt({
        durationMs: 12_500,
        tokens: tokens(1020, 900, 120),
        tools: [
          { name: "page_browser", calls: 2, failures: 1, paused: 0, durationMs: 150 },
          { name: "read_file", calls: 1, failures: 0, paused: 0, durationMs: 5 },
        ],
        artifacts: [
          { id: "art-1", name: "brief.md", mimeType: "text/markdown", size: 2048, version: 1 },
        ],
        effects: [{ kind: "github.issue.create", status: "completed" }],
        approvals: [
          { question: "Send the email?", status: "answered", answer: "Send" },
          { question: "Publish the post?", status: "pending", answer: null },
        ],
      }),
    );
    expect(lines).toEqual([
      "Duration: 12.5s",
      "Tokens: 1020 (900 in · 120 out)",
      "Tools: page_browser ×2, read_file ×1",
      "Artifacts: brief.md",
      "Effects: github.issue.create",
      "Approvals: Send the email? · answered; Publish the post? · pending",
    ]);
  });

  it("keeps a long tool list to one line by naming at most six tools", () => {
    const tools = Array.from({ length: 8 }, (_, index) => ({
      name: `tool_${index}`,
      calls: 1,
      failures: 0,
      paused: 0,
      durationMs: 0,
    }));
    const line = receiptLines(receipt({ tools })).find((entry) => entry.startsWith("Tools: "));
    expect(line).toBe("Tools: tool_0 ×1, tool_1 ×1, tool_2 ×1, tool_3 ×1, tool_4 ×1, tool_5 ×1");
  });

  it("leaves out every section the run has nothing for", () => {
    expect(receiptLines(receipt())).toEqual(["Tokens: —"]);
  });

  it("scales the duration from milliseconds to minutes", () => {
    const durationOf = (ms: number) =>
      receiptLines(receipt({ durationMs: ms })).find((line) => line.startsWith("Duration: "));
    expect(durationOf(500)).toBe("Duration: 500ms");
    expect(durationOf(125_000)).toBe("Duration: 2m 5s");
  });
});
