/**
 * Deployment switch for running stdio MCP servers as a process inside the bot's own
 * computer instead of inside this API/worker process. One truth table, read by both
 * roots through this helper — a second string parser would let the two processes flip
 * independently. Unset or anything unrecognized means off: today's host path, unchanged.
 */
export function deploymentMcpStdioInSandbox(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.RAKAZO_MCP_STDIO_IN_SANDBOX?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}
