import type { RunReceipt } from "@bobbot/contracts";
import { t } from "./i18n";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

/**
 * One run's receipt as plain lines, for a native alert. Mobile has no expandable row, so the
 * same stored rows the web receipt reads are shown as text; the labels stay translated.
 */
export function receiptLines(receipt: RunReceipt): string[] {
  const lines: string[] = [];
  if (receipt.stopReason) lines.push(receipt.stopReason);
  if (receipt.durationMs !== null) {
    lines.push(`${t("Duration")}: ${formatDuration(receipt.durationMs)}`);
  }
  const tokens = receipt.tokens;
  lines.push(
    `${t("Tokens")}: ${
      tokens ? `${tokens.totalTokens} (${tokens.inputTokens} in · ${tokens.outputTokens} out)` : "—"
    }`,
  );
  if (receipt.tools.length > 0) {
    lines.push(
      `${t("Tools")}: ${receipt.tools
        .slice(0, 6)
        .map((tool) => `${tool.name} ×${tool.calls}`)
        .join(", ")}`,
    );
  }
  if (receipt.artifacts.length > 0) {
    lines.push(
      `${t("Artifacts")}: ${receipt.artifacts.map((artifact) => artifact.name).join(", ")}`,
    );
  }
  if (receipt.effects.length > 0) {
    lines.push(`${t("Effects")}: ${receipt.effects.map((effect) => effect.kind).join(", ")}`);
  }
  if (receipt.approvals.length > 0) {
    lines.push(
      `${t("Approvals")}: ${receipt.approvals
        .map(
          (approval) =>
            `${approval.question} · ${approval.status === "answered" ? t("answered") : t("pending")}`,
        )
        .join("; ")}`,
    );
  }
  return lines;
}
