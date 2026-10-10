import { MessageBlock } from "@bobbot/contracts";
import { describe, expect, it } from "vitest";
import { buildApprovalAskBlock } from "./approval-ask.js";

describe("buildApprovalAskBlock", () => {
  it("binds the approval to its effect and redacts secrets", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "gmail_send_email",
      { to: "person@example.test", body: "token-secret" },
      ["token-secret"],
      {
        effect: { action: "publish", target: "gmail_send_email", risk: "high" },
      },
    );

    expect(block).toMatchObject({
      kind: "ask",
      approvalEffectId: "effect-1",
      effect: { action: "publish", target: "gmail_send_email", risk: "high" },
      actions: [
        { id: "allow", label: "Allow once" },
        { id: "always", label: "Always allow this tool" },
        { id: "deny", label: "Deny" },
      ],
    });
    expect(JSON.stringify(block)).not.toContain("token-secret");
    expect(MessageBlock.parse(block)).toMatchObject({
      kind: "ask",
      effect: { action: "publish", target: "gmail_send_email", risk: "high" },
    });
  });

  it("offers no permanent allow for a tool that answers per call", () => {
    const block = buildApprovalAskBlock(
      "effect-2",
      "skill_create",
      {
        name: "kurzfassung-abc",
        description: "Fasst lange Texte zusammen",
        body: "Fasse in 3 Stichpunkten zusammen.",
      },
      [],
      { effect: { action: "update", target: "skill_create", risk: "medium" } },
    );

    expect(block).toMatchObject({
      kind: "ask",
      text: "Review before skill_create",
      detail:
        "name: kurzfassung-abc\ndescription: Fasst lange Texte zusammen\nbody: Fasse in 3 Stichpunkten zusammen.",
      actions: [
        { id: "allow", label: "Allow once" },
        { id: "deny", label: "Deny" },
      ],
    });
  });

  it("redacts and bounds the effect target before persisting it", () => {
    const block = buildApprovalAskBlock("effect-1", "custom_write", {}, ["private-target"], {
      effect: {
        action: "update",
        target: `private-target${"x".repeat(250)}`,
        risk: "medium",
      },
    });

    expect(block).toMatchObject({
      kind: "ask",
      effect: { action: "update", risk: "medium" },
    });
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.effect?.target).not.toContain("private-target");
    expect(block.effect?.target.length).toBeLessThanOrEqual(201);
  });

  it("bounds model-controlled summaries and details", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "destination.write",
      { title: "t".repeat(1_000), body: "b".repeat(10_000) },
      [],
    );

    expect(block.kind).toBe("ask");
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.text.length).toBeLessThanOrEqual(501);
    expect(block.detail?.length).toBeLessThanOrEqual(4_001);
  });

  it("includes an optional review reason as the first detail line", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "gmail_send_email",
      { to: "person@example.test", subject: "Hi" },
      [],
      { reviewReason: "Sends email outside the draft-only task." },
    );

    expect(block.kind).toBe("ask");
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.detail?.startsWith("Sends email outside the draft-only task.")).toBe(true);
    expect(block.detail).toContain("to: person@example.test");
  });

  it("uses a one-time create or cancel choice for a new security boundary", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "create_space",
      { name: "Customer support" },
      [],
    );

    expect(block).toMatchObject({
      kind: "ask",
      text: "Create space “Customer support”?",
      actions: [
        { id: "allow", label: "Create space", outcome: "created" },
        { id: "deny", label: "Cancel", outcome: "cancelled" },
      ],
    });
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.detail).toContain("stay separate from other spaces");
  });
});
