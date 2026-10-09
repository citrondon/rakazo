import type { RunReceipt } from "@bobbot/contracts";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { rpc } from "../../lib/rpc";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

function formatTokens(receipt: RunReceipt, locale: string): string {
  if (!receipt.tokens) return "—";
  const total = receipt.tokens.totalTokens.toLocaleString(locale);
  const input = receipt.tokens.inputTokens.toLocaleString(locale);
  const output = receipt.tokens.outputTokens.toLocaleString(locale);
  return `${total} (${input} in · ${output} out)`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 py-0.5">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words">{value}</span>
    </div>
  );
}

/**
 * One run's receipt: what it did, measured from stored rows. Collapsed to a single quiet
 * line so the transcript keeps showing results, and fetched only when opened.
 */
export function RunReceiptRow({ runId }: { runId: string }) {
  const { t, i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [receipt, setReceipt] = useState<RunReceipt | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || receipt || loading) return;
    setLoading(true);
    try {
      setReceipt(await rpc.runs.receipt({ runId }));
    } catch {
      setReceipt(null);
    } finally {
      setLoading(false);
    }
  }

  const locale = i18n.locale || "en";
  return (
    <div className="mt-1 w-fit max-w-[min(88%,calc(100%_-_6rem))] text-[12.5px] text-muted-foreground">
      <button
        type="button"
        aria-expanded={open}
        data-testid="run-receipt-toggle"
        onClick={() => void toggle()}
        className="flex items-center gap-1.5 rounded-lg px-1 py-0.5 hover:text-foreground/75"
      >
        <ChevronRight
          size={12}
          strokeWidth={2}
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Trans>Receipt</Trans>
      </button>
      {open ? (
        <div
          data-testid="run-receipt"
          className="mt-1 rounded-[14px] border border-border bg-card px-3 py-2 leading-[1.6]"
        >
          {loading ? <div className="text-muted-foreground">…</div> : null}
          {!loading && !receipt ? (
            <div className="text-muted-foreground">
              <Trans>Receipt unavailable</Trans>
            </div>
          ) : null}
          {!loading && receipt ? (
            <>
              {receipt.stopReason ? (
                <div className="pb-1 text-destructive" dir="auto">
                  {receipt.stopReason}
                </div>
              ) : null}
              {receipt.durationMs !== null ? (
                <Row label={t`Duration`} value={formatDuration(receipt.durationMs)} />
              ) : null}
              <Row label={t`Tokens`} value={formatTokens(receipt, locale)} />
              {receipt.tools.length > 0 ? (
                <Row
                  label={t`Tools`}
                  value={receipt.tools
                    .slice(0, 6)
                    .map((tool) =>
                      tool.failures > 0
                        ? `${tool.name} ×${tool.calls} · ${tool.failures} failed`
                        : `${tool.name} ×${tool.calls}`,
                    )
                    .join(", ")}
                />
              ) : null}
              {receipt.artifacts.length > 0 ? (
                <Row
                  label={t`Artifacts`}
                  value={receipt.artifacts.map((artifact) => artifact.name).join(", ")}
                />
              ) : null}
              {receipt.effects.length > 0 ? (
                <Row
                  label={t`Effects`}
                  value={receipt.effects.map((effect) => effect.kind).join(", ")}
                />
              ) : null}
              {receipt.approvals.length > 0 ? (
                <div className="flex gap-3 py-0.5">
                  <span className="w-20 shrink-0 text-muted-foreground">
                    <Trans>Approvals</Trans>
                  </span>
                  <span className="min-w-0 flex-1">
                    {receipt.approvals.map((approval) => (
                      <div key={approval.question} dir="auto">
                        {approval.question}
                        {approval.status === "answered" ? (
                          <span className="text-muted-foreground"> · {t`answered`}</span>
                        ) : (
                          <span className="text-muted-foreground"> · {t`pending`}</span>
                        )}
                      </div>
                    ))}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
