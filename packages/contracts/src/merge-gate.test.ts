import { describe, it, expect } from "vitest";
import { GateRequirementSchema, GateResultSchema, MergeGateInputSchema, MergeGateOutputSchema } from "./merge-gate.js";

describe("GateRequirement", () => {
  it("validates required gate with name", () => {
    const gate = GateRequirementSchema.parse({ name: "ci", required: true });
    expect(gate.name).toBe("ci");
    expect(gate.required).toBe(true);
  });

  it("accepts optional timeoutMs", () => {
    const gate = GateRequirementSchema.parse({ name: "jev-decision", required: true, timeoutMs: 60000 });
    expect(gate.timeoutMs).toBe(60000);
  });

  it("rejects invalid gate name", () => {
    expect(() => GateRequirementSchema.parse({ name: "invalid-gate", required: true })).toThrow();
  });
});

describe("GateResult", () => {
  it("validates pass result with evidence", () => {
    const result = GateResultSchema.parse({
      name: "ci",
      status: "pass",
      evidence: { sha: "abc123", url: "https://ci.example.com/123" },
      decidedAt: new Date().toISOString(),
    });
    expect(result.status).toBe("pass");
    expect(result.evidence.sha).toBe("abc123");
  });

  it("validates fail result", () => {
    const result = GateResultSchema.parse({
      name: "qa-verdict",
      status: "fail",
      evidence: { reason: "tests failed" },
    });
    expect(result.status).toBe("fail");
  });

  it("validates skipped result", () => {
    const result = GateResultSchema.parse({
      name: "two-family-review",
      status: "skipped",
      evidence: { reason: "not configured" },
    });
    expect(result.status).toBe("skipped");
  });
});

describe("MergeGateInput", () => {
  it("validates complete input with multiple gates", () => {
    const input = MergeGateInputSchema.parse({
      prNumber: 42,
      headSha: "abc123",
      baseSha: "def456",
      requiredGates: [
        { name: "ci", required: true },
        { name: "two-family-review", required: true },
        { name: "qa-verdict", required: true },
        { name: "jev-decision", required: true },
      ],
    });
    expect(input.prNumber).toBe(42);
    expect(input.requiredGates).toHaveLength(4);
  });

  it("rejects empty requiredGates", () => {
    expect(() => MergeGateInputSchema.parse({
      prNumber: 1, headSha: "a", baseSha: "b", requiredGates: []
    })).toThrow();
  });
});

describe("MergeGateOutput", () => {
  it("validates allowed true when all pass", () => {
    const output = MergeGateOutputSchema.parse({
      allowed: true,
      results: [
        { name: "ci", status: "pass", evidence: {} },
        { name: "jev-decision", status: "pass", evidence: {} },
      ],
    });
    expect(output.allowed).toBe(true);
  });

  it("validates allowed false when any required fails", () => {
    const output = MergeGateOutputSchema.parse({
      allowed: false,
      results: [
        { name: "ci", status: "pass", evidence: {} },
        { name: "qa-verdict", status: "fail", evidence: { reason: "tests failed" } },
      ],
    });
    expect(output.allowed).toBe(false);
  });
});