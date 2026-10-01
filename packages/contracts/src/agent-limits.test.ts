import { describe, expect, it } from "vitest";
import {
  MAX_TOOL_CALLS_LIMIT_CEILING,
  MaxToolCallsPerTurnSchema,
  parseToolCallLimit,
  resolveToolCallLimit,
  toolCallLimitFromDraft,
} from "./agent-limits.js";

describe("parseToolCallLimit", () => {
  it("treats unset, empty, non-numeric, and non-positive values as unlimited", () => {
    expect(parseToolCallLimit(undefined)).toBe(0);
    expect(parseToolCallLimit(null)).toBe(0);
    expect(parseToolCallLimit("")).toBe(0);
    expect(parseToolCallLimit("   ")).toBe(0);
    expect(parseToolCallLimit("0")).toBe(0);
    expect(parseToolCallLimit("-5")).toBe(0);
    expect(parseToolCallLimit("abc")).toBe(0);
  });

  it("floors a positive value after trimming", () => {
    expect(parseToolCallLimit("80")).toBe(80);
    expect(parseToolCallLimit(" 12.9 ")).toBe(12);
    expect(parseToolCallLimit(7.8)).toBe(7);
    expect(parseToolCallLimit(0)).toBe(0);
  });
});

describe("resolveToolCallLimit", () => {
  it("inherits the deployment value only when the space stores nothing", () => {
    expect(resolveToolCallLimit(null, 10)).toBe(10);
    expect(resolveToolCallLimit(undefined, 10)).toBe(10);
  });

  it("lets a stored 0 mean unlimited instead of falling back", () => {
    expect(resolveToolCallLimit(0, 10)).toBe(0);
    expect(resolveToolCallLimit(0, 80)).toBe(0);
    expect(resolveToolCallLimit(200, 10)).toBe(200);
  });
});

describe("toolCallLimitFromDraft", () => {
  it("maps an empty draft to unlimited and a whole number to itself", () => {
    expect(toolCallLimitFromDraft("")).toBe(0);
    expect(toolCallLimitFromDraft("0")).toBe(0);
    expect(toolCallLimitFromDraft("200")).toBe(200);
  });

  it("rejects drafts that are not a whole number within the ceiling", () => {
    expect(toolCallLimitFromDraft("abc")).toBeNull();
    expect(toolCallLimitFromDraft("2.5")).toBeNull();
    expect(toolCallLimitFromDraft("-1")).toBeNull();
    expect(toolCallLimitFromDraft("100001")).toBeNull();
  });
});

describe("MaxToolCallsPerTurnSchema", () => {
  it("accepts null, zero, and the ceiling", () => {
    expect(MaxToolCallsPerTurnSchema.parse(null)).toBeNull();
    expect(MaxToolCallsPerTurnSchema.parse(0)).toBe(0);
    expect(MaxToolCallsPerTurnSchema.parse(MAX_TOOL_CALLS_LIMIT_CEILING)).toBe(
      MAX_TOOL_CALLS_LIMIT_CEILING,
    );
  });

  it("rejects a fraction and a value above the ceiling", () => {
    expect(MaxToolCallsPerTurnSchema.safeParse(2.5).success).toBe(false);
    expect(MaxToolCallsPerTurnSchema.safeParse(100001).success).toBe(false);
    expect(MaxToolCallsPerTurnSchema.safeParse(-1).success).toBe(false);
  });
});
