# Known issues

Open follow-ups that are not fixed yet. Keep entries short: symptom, cause, fix.

## A stdio MCP preset cannot be added on a new self-hosted deployment

**Symptom.** The "1-Klick Connectors" tiles (Web fetch, Structured reasoning, Notion)
read *"Set MCP_STDIO_ENABLED=true on the server to start this connector."*, and clicking
one answers *"Only the deployment owner can add a stdio MCP server"*.

**Cause.** Two independent gates in `apps/api/src/router.ts`:

1. `mcp.servers.stdioStatus` reports `enabled: env.mcpStdioEnabled === true`. While
   `MCP_STDIO_ENABLED` is unset or empty the UI disables every stdio preset.
2. `mcp.servers.create` refuses a `command` (stdio) server unless
   `actor.isDeploymentOwner`. The owner is the single `deployment_settings.ownerUserId`,
   which is not necessarily the account that is signed in.

Both gates exist on purpose: a stdio MCP server runs inside the API/worker container,
next to the database and the encryption keys, so it stays with the deployment owner and
behind the allow-list.

**Fix — pick one.**

- *Enable and own it.*
  1. `.env`: `MCP_STDIO_ENABLED=true` and add `npx` to `MCP_STDIO_ALLOWED_COMMANDS`.
  2. Point `deployment_settings.ownerUserId` at the account that should hold this power.
  3. Restart `api` and `worker`.
- *Drop the presets.* The managed catalog already offers web search and Notion over OAuth,
  so the stdio presets are redundant for a deployment that has the catalog.

**Watch out.** These presets pull a package from npm at runtime; keep every `args` version
pinned (no `npx -y <pkg>` without a version), because the code executes beside the database.
