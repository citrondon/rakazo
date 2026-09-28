import { describe, expect, it } from "vitest";
import { buildRunReceipt, type RunReceiptInput, sumRunTokens, summarizeRunTools } from "./run-receipt.js";

const run = {
  id: "run-1",
  botId: "bot-1",
  botName: "Researcher",
  threadId: "thread-1",
  trigger: "user",
  status: "completed",
  modelProvider: "openrouter",
  modelId: "openai/gpt-5.6-luna",
  startedAt: new Date("2026-09-28T10:00:00.000Z"),
  completedAt: new Date("2026-09-28T10:00:12.500Z"),
  error: null,
};

function input(overrides: Partial<RunReceiptInput> = {}): RunReceiptInput {
  return {
    run,
    toolEvents: [],
    usage: [],
    artifacts: [],
    effects: [],
    approvals: [],
    ...overrides,
  };
}

describe("summarizeRunTools", () => {
  it("folds calls and completions per tool name and sums durations", () => {
    const tools = summarizeRunTools([
      { type: "agent.tool.called", payload: { name: "page_browser", executionId: "e1" } },
      { type: "agent.tool.completed", payload: { name: "page_browser", outcome: "succeeded", durationMs: 120 } },
      { type: "agent.tool.called", payload: { name: "page_browser", executionId: "e2" } },
      { type: "agent.tool.completed", payload: { name: "page_browser", outcome: "error", durationMs: 30, error: "boom" } },
      { type: "agent.tool.called", payload: { name: "read_file", executionId: "e3" } },
      { type: "agent.tool.completed", payload: { name: "read_file", outcome: "succeeded", durationMs: 5 } },
    ]);
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({
      name: "page_browser",
      calls: 2,
      failures: 1,
      paused: 0,
      durationMs: 150,
    });
    expect(tools[1]).toMatchObject({ name: "read_file", calls: 1, failures: 0, durationMs: 5 });
  });

  it("counts a completion that never had a call as one call", () => {
    // MCP discovery failures are recorded as completions without a preceding call.
    const tools = summarizeRunTools([
      { type: "agent.tool.completed", payload: { name: "mcp__treg", outcome: "error" } },
    ]);
    expect(tools).toEqual([
      { name: "mcp__treg", calls: 1, failures: 1, paused: 0, durationMs: 0 },
    ]);
  });

  it("ignores events without a usable tool name and pauses stay separate from failures", () => {
    const tools = summarizeRunTools([
      { type: "agent.tool.called", payload: {} },
      { type: "agent.tool.completed", payload: { name: "ask_user", outcome: "paused" } },
    ]);
    expect(tools).toEqual([{ name: "ask_user", calls: 1, failures: 0, paused: 1, durationMs: 0 }]);
  });
});

describe("sumRunTokens", () => {
  it("returns null when the run spent nothing so a stopped run is not read as free", () => {
    expect(sumRunTokens([])).toBeNull();
  });

  it("counts cache directions toward the total", () => {
    expect(
      sumRunTokens([
        { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2, cacheWriteTokens: 1 },
        { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      ]),
    ).toEqual({
      inputTokens: 15,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      totalTokens: 23,
    });
  });
});

describe("buildRunReceipt", () => {
  it("describes a completed run without inventing data", () => {
    const receipt = buildRunReceipt(
      input({
        toolEvents: [
          { type: "agent.tool.called", payload: { name: "page_browser" } },
          { type: "agent.tool.completed", payload: { name: "page_browser", outcome: "succeeded", durationMs: 40 } },
        ],
        usage: [{ inputTokens: 900, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 }],
        artifacts: [
          { id: "art-1", name: "brief.md", mimeType: "text/markdown", size: 2048, version: 1 },
        ],
        effects: [{ kind: "github.issue.create", status: "completed" }],
        approvals: [
          { question: "Send the email?", status: "answered", answer: "Send" },
          { question: "   ", status: "pending", answer: null },
        ],
      }),
    );
    expect(receipt.runId).toBe("run-1");
    expect(receipt.durationMs).toBe(12_500);
    expect(receipt.toolCalls).toBe(1);
    expect(receipt.tokens?.totalTokens).toBe(1020);
    expect(receipt.artifacts).toEqual([
      { id: "art-1", name: "brief.md", mimeType: "text/markdown", size: 2048, version: 1 },
    ]);
    expect(receipt.effects).toEqual([{ kind: "github.issue.create", status: "completed" }]);
    expect(receipt.approvals).toEqual([
      { question: "Send the email?", status: "answered", answer: "Send" },
    ]);
    expect(receipt.stopReason).toBeNull();
  });

  it("reports a run that stopped before its first model call", () => {
    const receipt = buildRunReceipt(
      input({
        run: {
          ...run,
          status: "failed",
          startedAt: null,
          completedAt: null,
          error: "  Monthly token budget exhausted for this bot.  ",
        },
      }),
    );
    expect(receipt.tokens).toBeNull();
    expect(receipt.durationMs).toBeNull();
    expect(receipt.toolCalls).toBe(0);
    expect(receipt.stopReason).toBe("Monthly token budget exhausted for this bot.");
  });

  it("treats a blank error as no stop reason", () => {
    expect(buildRunReceipt(input({ run: { ...run, error: "   " } })).stopReason).toBeNull();
  });
});
