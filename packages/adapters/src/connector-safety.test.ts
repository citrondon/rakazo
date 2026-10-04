import { describe, expect, it } from "vitest";
import { redactConnectorPayload, sanitizeConnectorError } from "./connector-safety.js";

describe("redactConnectorPayload", () => {
  it("redacts secrets that JSON escapes in property names and values", () => {
    const secret = 'api"key';

    expect(
      redactConnectorPayload(
        {
          [secret]: `prefix ${secret} suffix`,
          nested: { value: secret },
        },
        [secret],
      ),
    ).toEqual({
      "[redacted]": "prefix [redacted] suffix",
      nested: { value: "[redacted]" },
    });
  });

  it("falls back to an inert result when the payload is not JSON serializable", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(redactConnectorPayload(circular, ["secret"])).toEqual({ ok: true });
  });

  it("redacts secrets represented by non-string JSON leaves", () => {
    expect(
      redactConnectorPayload({ number: 123, boolean: true, empty: null }, ["123", "true", "null"]),
    ).toEqual({ number: "[redacted]", boolean: "[redacted]", empty: "[redacted]" });
  });
  describe("sanitizeConnectorError — UI-boundary mapping", () => {
    it("maps sandbox-identity error to a safe user message", () => {
      const out = sanitizeConnectorError(
        new Error("stdio MCP in the sandbox needs a bot identity"),
      );
      expect(out).toBe(
        "MCP stdio: bot has no identity (botId missing). Assign the bot to an agent computer first.",
      );
    });

    it("maps 'Bot has no computer' to a safe user message", () => {
      const out = sanitizeConnectorError(new Error("Bot has no computer"));
      expect(out).toBe(
        "This bot has no computer assigned — configure a computer for the bot before using MCP stdio.",
      );
    });

    it("maps provider-cannot-host error to a safe user message", () => {
      const out = sanitizeConnectorError(
        new Error("this computer provider cannot host a stdio process"),
      );
      expect(out).toBe("This computer provider cannot host a stdio process — use E2B or Docker.");
    });

    it("maps missing-resolver error to a safe user message", () => {
      const out = sanitizeConnectorError(
        new Error(
          "MCP stdio runs in the bot's computer, but this deployment gave no computer resolver or process opener",
        ),
      );
      expect(out).toBe(
        "MCP stdio is enabled but this deployment has no computer resolver or process opener wired up.",
      );
    });

    it("passes through unmapped messages unchanged (after redaction)", () => {
      const out = sanitizeConnectorError(new Error("some other failure"));
      expect(out).toBe("some other failure");
    });
  });
});
