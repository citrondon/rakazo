import { sanitizeConnectorError } from "./connector-safety.js";
import { transportFailureDetail } from "./remote-mcp.js";

/** Why an MCP connection or a provider credential check failed, in one bucket. */
export type McpFailureKind =
  | "invalid_url"
  | "insecure_url"
  | "private_endpoint"
  | "blocked_host"
  | "dns"
  | "timeout"
  | "auth"
  | "tls"
  | "unreachable"
  | "stdio_disabled"
  | "stdio_command"
  | "protocol"
  | "unknown";

export interface McpFailureContext {
  /** Endpoint host, or the stdio command — whichever the failing path knows. */
  host?: string;
  /** Values that must never reach the user: tokens, keys, headers. */
  secrets?: readonly string[];
}

export interface McpFailure {
  kind: McpFailureKind;
  message: string;
}

export const MCP_PRIVATE_ENDPOINT_HINT =
  "Set MCP_ALLOW_PRIVATE_ENDPOINT=true on the API and worker to allow it, or connect it as the deployment owner.";

export const MCP_HTTPS_HINT =
  "Use an https:// URL. Plain http:// only works for loopback and private endpoints (MCP_ALLOW_PRIVATE_ENDPOINT=true).";

const MAX_CAUSE_DEPTH = 5;
const UNKNOWN_MESSAGE_LIMIT = 300;
const UNREACHABLE_DETAIL_LIMIT = 200;

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NODATA", "NXDOMAIN"]);
const TIMEOUT_CODES = new Set(["UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT", "ABORT_ERR"]);
const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ECONNABORTED",
  "UND_ERR_SOCKET",
]);
const TLS_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
]);
const TLS_CODE_PREFIX = "ERR_SSL_";
const SPAWN_CODE = "ENOENT";

/**
 * Turn an MCP connect/discovery/call failure into one short sentence that names the
 * cause. Raw SDK text (`fetch failed`, a Node stack, an undici `cause` chain) never
 * reaches the user: every message is built from `sanitizeConnectorError` output, so
 * the same redaction the connectors already relied on still applies.
 */
export function describeMcpFailure(error: unknown, context: McpFailureContext = {}): McpFailure {
  const host = normalizeHost(context.host);
  const raw = sanitizeConnectorError(error, [...(context.secrets ?? [])]);
  const codes = errorCodes(error);

  if (/Connector URL is invalid/.test(raw)) {
    return { kind: "invalid_url", message: "MCP endpoint is not a valid URL." };
  }
  if (/must use HTTPS/.test(raw)) {
    return { kind: "insecure_url", message: `MCP endpoint must use HTTPS. ${MCP_HTTPS_HINT}` };
  }
  if (/targets a private host|resolves to a private address/.test(raw)) {
    return {
      kind: "private_endpoint",
      message: `MCP endpoint targets a private host${host ? ` (${host})` : ""}. ${MCP_PRIVATE_ENDPOINT_HINT}`,
    };
  }
  if (/link-local/.test(raw)) {
    return {
      kind: "blocked_host",
      message:
        "MCP endpoint targets a cloud-metadata or link-local address. That address stays blocked on every deployment.",
    };
  }
  if (/MCP_STDIO_ALLOWED_COMMANDS|is not in the configured allowlist/.test(raw)) {
    return { kind: "stdio_command", message: stdioCommandMessage(commandFrom(raw, host)) };
  }
  if (/MCP_STDIO_ENABLED|stdio servers are disabled/.test(raw)) {
    return {
      kind: "stdio_disabled",
      message: "MCP stdio servers are disabled on this deployment (MCP_STDIO_ENABLED=true).",
    };
  }
  if (/no agent home root/.test(raw)) {
    return { kind: "stdio_command", message: stdioCommandMessage(commandFrom(raw, host)) };
  }

  if ((error instanceof Error && error.name === "AbortError") || codes.has("ABORT_ERR")) {
    return { kind: "timeout", message: timeoutMessage(host) };
  }
  if (hasCode(codes, DNS_CODES)) return { kind: "dns", message: dnsMessage(host) };
  if (hasCode(codes, TIMEOUT_CODES)) return { kind: "timeout", message: timeoutMessage(host) };
  if (hasCode(codes, NETWORK_CODES)) {
    return { kind: "unreachable", message: unreachableMessage(host, error) };
  }
  if (hasCode(codes, TLS_CODES) || [...codes].some((code) => code.startsWith(TLS_CODE_PREFIX))) {
    return { kind: "tls", message: tlsMessage(host) };
  }
  if (codes.has(SPAWN_CODE)) {
    return { kind: "stdio_command", message: stdioCommandMessage(host) };
  }

  if (/\b40[13]\b|Unauthorized|Forbidden/i.test(raw)) {
    return { kind: "auth", message: authMessage(host) };
  }
  if (/\b5\d\d\b|JSON-RPC|Invalid Request|Method not found|Unexpected token/i.test(raw)) {
    return { kind: "protocol", message: protocolMessage(host) };
  }
  if (/\b404\b|not found/i.test(raw)) {
    return { kind: "protocol", message: protocolMessage(host) };
  }

  const cleaned = stripFrames(raw);
  return {
    kind: "unknown",
    message: cleaned
      ? cleaned.slice(0, UNKNOWN_MESSAGE_LIMIT)
      : host
        ? `MCP server ${host} failed. Check the endpoint.`
        : "MCP server failed. Check the endpoint.",
  };
}

/**
 * Credential checks against a managed connector provider (Composio, Pipedream).
 * The raw provider payload can embed the key itself, so only the bucket is relayed.
 */
export function describeCredentialCheckFailure(error: unknown): McpFailure {
  const raw = sanitizeConnectorError(error);
  const codes = errorCodes(error);

  if (/\b40[13]\b|Unauthorized|Forbidden/i.test(raw)) {
    return { kind: "auth", message: "The provider rejected these credentials (HTTP 401/403)." };
  }
  if (
    hasCode(codes, DNS_CODES) ||
    hasCode(codes, TIMEOUT_CODES) ||
    hasCode(codes, NETWORK_CODES) ||
    /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up/i.test(raw)
  ) {
    return {
      kind: "unreachable",
      message:
        "Could not reach the provider (network or DNS). Check outbound connectivity from the API and worker.",
    };
  }
  return { kind: "unknown", message: "Could not verify these credentials." };
}

function normalizeHost(host: string | undefined): string | undefined {
  const trimmed = host?.trim();
  return trimmed ? trimmed : undefined;
}

/** Codes from the error itself, its aggregate members and its whole `cause` chain. */
function errorCodes(error: unknown): Set<string> {
  const codes = new Set<string>();
  collectCodes(error, codes, 0);
  return codes;
}

function collectCodes(error: unknown, codes: Set<string>, depth: number): void {
  if (depth >= MAX_CAUSE_DEPTH || !(error instanceof Error)) return;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") codes.add(code);
  if (error instanceof AggregateError) {
    for (const inner of error.errors) collectCodes(inner, codes, depth + 1);
  }
  collectCodes(error.cause, codes, depth + 1);
}

function hasCode(codes: Set<string>, candidates: Set<string>): boolean {
  for (const code of codes) if (candidates.has(code)) return true;
  return false;
}

function dnsMessage(host?: string): string {
  return host
    ? `Could not resolve ${host} (DNS). Check the hostname of the MCP endpoint.`
    : "Could not resolve the MCP host name (DNS). Check the hostname of the MCP endpoint.";
}

function timeoutMessage(host?: string): string {
  return host
    ? `MCP server ${host} did not answer in time (timeout).`
    : "The MCP server did not answer in time (timeout).";
}

function authMessage(host?: string): string {
  const target = host ? `MCP server ${host}` : "The MCP server";
  return `${target} rejected the credentials (HTTP 401/403). Reconnect OAuth or replace the stored token.`;
}

function tlsMessage(host?: string): string {
  const target = host ? `MCP server ${host}` : "The MCP server";
  return `${target} failed the TLS handshake. Check the certificate of that endpoint.`;
}

function protocolMessage(host?: string): string {
  const target = host ? `MCP server ${host}` : "The MCP server";
  return `${target} answered in an unexpected way. Check that the endpoint speaks MCP.`;
}

/** undici hides the real reason behind `fetch failed`; the cause chain still has it. */
function unreachableMessage(host: string | undefined, error: unknown): string {
  const detail = transportFailureDetail(error)?.slice(0, UNREACHABLE_DETAIL_LIMIT);
  const target = host ? `MCP server ${host}` : "The MCP server";
  return `${target} is unreachable${detail ? `: ${detail}` : ""}.`;
}

function stdioCommandMessage(command: string | undefined): string {
  return `MCP stdio command "${command ?? "(unknown)"}" is not allowed here (MCP_STDIO_ALLOWED_COMMANDS).`;
}

/** Prefer the executable already quoted in the message; fall back to the known host. */
function commandFrom(raw: string, host: string | undefined): string | undefined {
  const quoted = /"([^"]*)"/.exec(raw);
  return quoted?.[1] ?? host;
}

/** Node stacks and a bare `fetch failed` carry no cause the user can act on. */
function stripFrames(raw: string): string {
  const cleaned = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("at "))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return /^fetch failed$/i.test(cleaned) ? "" : cleaned;
}
