import { describe, expect, it } from "vitest";
import { deploymentMcpStdioInSandbox } from "./mcp-stdio.js";

describe("deploymentMcpStdioInSandbox", () => {
  it("is off when the flag is unset, empty or false-ish", () => {
    expect(deploymentMcpStdioInSandbox({})).toBe(false);
    expect(deploymentMcpStdioInSandbox({ RAKAZO_MCP_STDIO_IN_SANDBOX: "" })).toBe(false);
    expect(deploymentMcpStdioInSandbox({ RAKAZO_MCP_STDIO_IN_SANDBOX: "false" })).toBe(false);
    expect(deploymentMcpStdioInSandbox({ RAKAZO_MCP_STDIO_IN_SANDBOX: "0" })).toBe(false);
    expect(deploymentMcpStdioInSandbox({ RAKAZO_MCP_STDIO_IN_SANDBOX: "nope" })).toBe(false);
  });
  it("is on for the canonical truth words", () => {
    for (const value of ["1", "true", "yes", "on"]) {
      expect(deploymentMcpStdioInSandbox({ RAKAZO_MCP_STDIO_IN_SANDBOX: value })).toBe(true);
    }
  });
  it("tolerates whitespace and uppercase", () => {
    expect(deploymentMcpStdioInSandbox({ RAKAZO_MCP_STDIO_IN_SANDBOX: "  TRUE  " })).toBe(true);
    expect(deploymentMcpStdioInSandbox({ RAKAZO_MCP_STDIO_IN_SANDBOX: "Yes" })).toBe(true);
    expect(deploymentMcpStdioInSandbox({ RAKAZO_MCP_STDIO_IN_SANDBOX: "\ton\n" })).toBe(true);
    expect(deploymentMcpStdioInSandbox({ RAKAZO_MCP_STDIO_IN_SANDBOX: " 1 " })).toBe(true);
  });
});
