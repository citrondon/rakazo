import { describe, expect, it } from "vitest";
import { endpointGateNotice } from "./mcp-endpoint-notice";

describe("endpointGateNotice", () => {
  it("stays silent on an empty, unparseable, https:// or non-http URL", () => {
    expect(endpointGateNotice("")).toBeNull();
    expect(endpointGateNotice("   ")).toBeNull();
    expect(endpointGateNotice("not a url")).toBeNull();
    expect(endpointGateNotice("https://mcp.example.test/mcp")).toBeNull();
    expect(endpointGateNotice("stdio://local/mcp")).toBeNull();
  });

  it("names the https rule for plain http on a public host", () => {
    expect(endpointGateNotice("http://mcp.example.test/mcp")).toBe("https");
  });

  it("names the private-endpoint gate for a private host over plain http", () => {
    expect(endpointGateNotice("http://localhost:8123/api/mcp")).toBe("private");
    expect(endpointGateNotice("http://10.0.0.8:3927/mcp")).toBe("private");
    expect(endpointGateNotice("http://host.docker.internal:8123/mcp")).toBe("private");
    expect(endpointGateNotice("http://box.internal/mcp")).toBe("private");
    expect(endpointGateNotice("http://notes.localhost/mcp")).toBe("private");
  });

  it("does not warn on a private host reached over https://", () => {
    expect(endpointGateNotice("https://box.internal/mcp")).toBeNull();
  });
});
