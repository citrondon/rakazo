import { isLocalMcpHost, isPrivateNetworkHost } from "@bobbot/contracts";

/**
 * Which endpoint gate a typed server URL would hit: the two refusals
 * `assertSafeRemoteUrl` makes for a remote MCP endpoint that no flag fixes.
 * Advisory only — the server stays authoritative and the notice never blocks the add.
 */
export type McpEndpointNotice = "https" | "private" | null;

export function endpointGateNotice(endpoint: string): McpEndpointNotice {
  const trimmed = endpoint.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  // https:// and every other scheme is the server's decision.
  if (url.protocol !== "http:") return null;
  return isPrivateEndpointHost(url.hostname) ? "private" : "https";
}

/** Mirrors `isPrivateRemoteMcpHostname` so the notice cannot disagree with the server. */
function isPrivateEndpointHost(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  return (
    isLocalMcpHost(normalized) ||
    isPrivateNetworkHost(normalized) ||
    normalized === "host.docker.internal" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".internal")
  );
}
