import { Trans } from "@lingui/react/macro";
import type { McpPreset, stdioBlockerReason } from "./mcp-presets";

type BlockerReason = ReturnType<typeof stdioBlockerReason>;

/**
 * Names the deployment switch an operator has to set before this stdio connector can start.
 * An installed server saves without error, so without this note the gallery would advertise a
 * connector that only fails later, inside a bot run.
 */
export function McpPresetBlockerNote({
  preset,
  reason,
}: {
  preset: McpPreset;
  reason: BlockerReason;
}) {
  if (!reason) return null;
  return (
    <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
      {reason === "disabled" ? (
        <Trans>Set MCP_STDIO_ENABLED=true on the server to start this connector.</Trans>
      ) : (
        <Trans>
          Add {preset.command} to MCP_STDIO_ALLOWED_COMMANDS on the server to start this connector.
        </Trans>
      )}
    </p>
  );
}
