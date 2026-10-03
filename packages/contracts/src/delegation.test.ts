import { describe, expect, it } from "vitest";
import { DelegationRequestSchema, DelegationResultSchema, QueueEntrySchema } from "./delegation.js";

describe("DelegationRequest", () => {
  it("requires missionId, sliceId, roleId, acceptanceCriteria", () => {
    const req = DelegationRequestSchema.parse({
      missionId: "m01-checkout",
      sliceId: "03-checkout-form",
      roleId: "checkout-implementer",
      acceptanceCriteria: ["tests pass", "typecheck clean", "WCAG 2.1 AA"],
    });
    expect(req.missionId).toBe("m01-checkout");
    expect(req.acceptanceCriteria).toHaveLength(3);
  });

  it("rejects missing acceptanceCriteria", () => {
    expect(() =>
      DelegationRequestSchema.parse({
        missionId: "m01",
        sliceId: "s1",
        roleId: "r1",
        acceptanceCriteria: [],
      }),
    ).toThrow();
  });

  it("accepts optional fields", () => {
    const req = DelegationRequestSchema.parse({
      missionId: "m01",
      sliceId: "s1",
      roleId: "r1",
      acceptanceCriteria: ["tests pass"],
      parentSeatId: "seat-123",
      modelOverride: {
        family: "Anthropic",
        model: "claude-sonnet-4",
        temperature: 0.3,
        maxTokens: 16384,
        costTier: "medium",
      },
      timeoutMs: 1800000,
      artifacts: ["src/checkout.tsx", "tests/checkout.test.tsx"],
      dependencies: ["02-auth-flow"],
    });
    expect(req.artifacts).toHaveLength(2);
  });
});

describe("QueueEntry", () => {
  it("tracks status transitions", () => {
    const entry = QueueEntrySchema.parse({
      id: "q-123",
      request: { missionId: "m", sliceId: "s", roleId: "r", acceptanceCriteria: ["ok"] },
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    expect(entry.status).toBe("pending");
  });
});

describe("DelegationResult", () => {
  it("validates success result with artifacts and logs", () => {
    const result = DelegationResultSchema.parse({
      success: true,
      artifacts: ["a.ts", "b.ts"],
      logs: ["started", "completed"],
    });
    expect(result.success).toBe(true);
    expect(result.artifacts).toHaveLength(2);
  });

  it("validates failure result with error", () => {
    const result = DelegationResultSchema.parse({
      success: false,
      artifacts: [],
      logs: ["failed"],
      error: "TypeError: something went wrong",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
