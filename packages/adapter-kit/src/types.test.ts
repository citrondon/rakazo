import { describe, expect, it } from "vitest";
import type { AgentRuntimeEvent } from "./types.js";

describe("AgentRuntimeEvent", () => {
  it("carries an opt-in thinking delta distinct from user-visible text", () => {
    const event: AgentRuntimeEvent = { type: "thinking", text: "weighing options" };
    expect(event.type).toBe("thinking");
  });
});
