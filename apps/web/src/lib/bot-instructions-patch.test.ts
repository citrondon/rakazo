import { describe, expect, it } from "vitest";
import { instructionsPatch } from "./bot-instructions-patch";

describe("instructionsPatch", () => {
  it("keeps the stored instructions when the description was not edited", () => {
    expect(instructionsPatch("Kurzer Text", "Kurzer Text")).toEqual({});
    expect(instructionsPatch("  Kurzer Text  ", "Kurzer Text")).toEqual({});
  });
  it("sends the edited description as the new instructions", () => {
    expect(instructionsPatch("Alt", "Neu")).toEqual({ instructions: "Neu" });
    expect(instructionsPatch("Alt", "")).toEqual({ instructions: "" });
  });
});
