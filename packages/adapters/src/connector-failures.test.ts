import { describe, expect, it } from "vitest";
import {
  describeCredentialCheckFailure,
  describeMcpFailure,
  MCP_HTTPS_HINT,
  MCP_PRIVATE_ENDPOINT_HINT,
} from "./connector-failures.js";

const HOST = "mcp.example.test";

function abortError(): Error {
  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  return error;
}

describe("describeMcpFailure", () => {
  it("classifies gate sentences with the flag that lifts them", () => {
    expect(describeMcpFailure(new Error("Connector URL is invalid")).kind).toBe("invalid_url");

    const insecure = describeMcpFailure(new Error("Connector URL must use HTTPS"));
    expect(insecure.kind).toBe("insecure_url");
    expect(insecure.message).toContain(MCP_HTTPS_HINT);

    const priv = describeMcpFailure(new Error("Connector URL targets a private host"), {
      host: "10.0.0.8:3927",
    });
    expect(priv.kind).toBe("private_endpoint");
    expect(priv.message).toContain("MCP_ALLOW_PRIVATE_ENDPOINT=true");
    expect(priv.message).toContain("10.0.0.8:3927");
    expect(priv.message).toContain(MCP_PRIVATE_ENDPOINT_HINT);

    const blocked = describeMcpFailure(
      new Error("Private fetch URL resolved to a link-local address"),
    );
    expect(blocked.kind).toBe("blocked_host");
    expect(blocked.message).toContain("link-local");
  });

  it("classifies stdio gates with the allowlist flag and the offending command", () => {
    const command = describeMcpFailure(
      new Error(
        'MCP stdio command "bash" is not in the configured allowlist (MCP_STDIO_ALLOWED_COMMANDS)',
      ),
    );
    expect(command.kind).toBe("stdio_command");
    expect(command.message).toBe(
      'MCP stdio command "bash" is not allowed here (MCP_STDIO_ALLOWED_COMMANDS).',
    );

    const disabled = describeMcpFailure(
      new Error("MCP stdio servers are disabled on this deployment (MCP_STDIO_ENABLED=true)"),
    );
    expect(disabled.kind).toBe("stdio_disabled");
    expect(disabled.message).toContain("MCP_STDIO_ENABLED=true");

    const home = describeMcpFailure(
      new Error("MCP stdio argument uses {home}, but this deployment has no agent home root"),
      { host: "server-filesystem" },
    );
    expect(home.kind).toBe("stdio_command");
    expect(home.message).toContain("server-filesystem");
  });

  it("classifies DNS, timeout, TLS and unreachable failures from the cause chain", () => {
    const dns = describeMcpFailure(
      Object.assign(new TypeError("fetch failed"), { code: "ENOTFOUND" }),
      { host: HOST },
    );
    expect(dns.kind).toBe("dns");
    expect(dns.message).toContain("Could not resolve");
    expect(dns.message).toContain(HOST);

    const timeout = describeMcpFailure(abortError(), { host: HOST });
    expect(timeout.kind).toBe("timeout");
    expect(timeout.message).toContain(HOST);
    expect(timeout.message).toContain("timeout");

    const tls = describeMcpFailure(Object.assign(new Error("boom"), { code: "CERT_HAS_EXPIRED" }), {
      host: HOST,
    });
    expect(tls.kind).toBe("tls");
    expect(tls.message).toContain("TLS");

    const unreachable = describeMcpFailure(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.8:3927"), {
          code: "ECONNREFUSED",
        }),
      }),
      { host: HOST },
    );
    expect(unreachable.kind).toBe("unreachable");
    expect(unreachable.message).toContain(`MCP server ${HOST} is unreachable`);
    expect(unreachable.message).toContain("connect ECONNREFUSED 10.0.0.8:3927");
  });

  it("classifies auth and protocol answers", () => {
    const auth = describeMcpFailure(new Error("HTTP 401 Unauthorized"), { host: HOST });
    expect(auth.kind).toBe("auth");
    expect(auth.message).toContain("401/403");

    const server = describeMcpFailure(new Error("Unexpected server error 503"), { host: HOST });
    expect(server.kind).toBe("protocol");

    const parse = describeMcpFailure(new Error("JSON-RPC Error: Unexpected token < in JSON"), {
      host: HOST,
    });
    expect(parse.kind).toBe("protocol");
    expect(parse.message).toContain("speaks MCP");
  });

  it("strips stacks and the bare `fetch failed` text from unclassified failures", () => {
    const stacked = describeMcpFailure(
      new Error("boom\n    at Object.<anonymous> (/app/dist/index.js:1:1)"),
      { host: HOST },
    );
    expect(stacked.kind).toBe("unknown");
    expect(stacked.message).toBe("boom");
    expect(stacked.message).not.toContain("\n    at ");
    expect(stacked.message).not.toContain("at Object");

    const bare = describeMcpFailure(new TypeError("fetch failed"), { host: HOST });
    expect(bare.kind).toBe("unknown");
    expect(bare.message).not.toBe("fetch failed");
    expect(bare.message).toBe(`MCP server ${HOST} failed. Check the endpoint.`);

    const empty = describeMcpFailure(new Error(""), { host: HOST });
    expect(empty.message).toBe(`MCP server ${HOST} failed. Check the endpoint.`);

    const long = describeMcpFailure(new Error("x".repeat(900)), { host: HOST });
    expect(long.message.length).toBe(300);
  });

  it("never prints undefined and caps the unreachable detail", () => {
    const dns = describeMcpFailure(
      Object.assign(new TypeError("fetch failed"), { code: "ENOTFOUND" }),
    );
    expect(dns.kind).toBe("dns");
    expect(dns.message).not.toContain("undefined");

    const detail = describeMcpFailure(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error(`connect ECONNREFUSED ${"y".repeat(300)}`), {
          code: "ECONNREFUSED",
        }),
      }),
    );
    expect(detail.kind).toBe("unreachable");
    expect(detail.message).not.toContain("undefined");
    expect(detail.message.length).toBeLessThan(300);
  });

  it("redacts every secret before it can reach the message", () => {
    const raw = describeMcpFailure(
      new Error("call failed for ak_live_abcdef123456 and super-secret-token"),
      { host: HOST, secrets: ["super-secret-token", "ak_live_abcdef123456"] },
    );
    expect(raw.message).not.toContain("super-secret-token");
    expect(raw.message).not.toContain("ak_live_abcdef123456");
    expect(raw.message).toContain("[redacted]");

    const gate = describeMcpFailure(new Error("Connector URL targets a private host"), {
      host: HOST,
      secrets: ["super-secret-token"],
    });
    expect(gate.message).not.toContain("super-secret-token");
  });
});

describe("describeCredentialCheckFailure", () => {
  it("names a rejected key", () => {
    expect(describeCredentialCheckFailure(new Error("401 Unauthorized")).message).toBe(
      "The provider rejected these credentials (HTTP 401/403).",
    );
    expect(describeCredentialCheckFailure(new Error("Forbidden")).kind).toBe("auth");
  });

  it("names an unreachable provider", () => {
    const dns = describeCredentialCheckFailure(
      Object.assign(new TypeError("fetch failed"), { code: "ENOTFOUND" }),
    );
    expect(dns.kind).toBe("unreachable");
    expect(dns.message).toContain("Could not reach the provider");

    const refused = describeCredentialCheckFailure(new Error("connect ECONNREFUSED 127.0.0.1:80"));
    expect(refused.kind).toBe("unreachable");
  });

  it("stays generic when the reason is unknown", () => {
    const unknown = describeCredentialCheckFailure(new Error("fake-secret-in-provider-response"));
    expect(unknown.kind).toBe("unknown");
    expect(unknown.message).toBe("Could not verify these credentials.");
    expect(unknown.message).not.toContain("fake-secret-in-provider-response");
  });
});
