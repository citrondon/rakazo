import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { Bot, BotPresetSummary, ExportManifest, ImportPreview } from "@rakazo/contracts";
import { BotImportInputSchema } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@rakazo/ui-web";
import { Library, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { rpc } from "../lib/rpc";

/**
 * Start a bot from a preset the library ships (bot-library/*.v1.json).
 * Pick a preset, review what it brings, then import. The list carries summaries
 * only and one preset's body travels once it is chosen, so opening this stays
 * cheap however large the library grows. Import runs the same path the file
 * upload uses, so both surfaces produce an identical bot.
 */
export function BotLibraryOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const [presets, setPresets] = useState<BotPresetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ExportManifest | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [integrations, setIntegrations] = useState<string[]>([]);
  const [includeMemory, setIncludeMemory] = useState(true);
  const [includeRoutines, setIncludeRoutines] = useState(true);
  const [includeSkills, setIncludeSkills] = useState(true);
  const [includeFiles, setIncludeFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<Bot | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc.bots
      .presets()
      .then((list) => {
        if (!cancelled) setPresets(list);
      })
      .catch(() => {
        if (!cancelled) setError(t`Could not read the bot library.`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const needle = query.trim().toLowerCase();
  const matched = useMemo(() => {
    if (!needle) return presets;
    return presets.filter((preset) =>
      `${preset.name} ${preset.title} ${preset.description}`.toLowerCase().includes(needle),
    );
  }, [presets, needle]);

  useEffect(() => {
    if (!selectedSlug) {
      setManifest(null);
      return;
    }
    let cancelled = false;
    setError(null);
    rpc.bots
      .preset({ slug: selectedSlug })
      .then((next) => {
        if (!cancelled) setManifest(next);
      })
      .catch(() => {
        if (!cancelled) setError(t`Could not read this preset.`);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSlug, t]);

  useEffect(() => {
    if (!manifest) {
      setPreview(null);
      setIntegrations([]);
      return;
    }
    const parsed = BotImportInputSchema.safeParse({
      manifest,
      includeMemory,
      includeRoutines,
      includeSkills,
      includeFiles,
    });
    if (!parsed.success) {
      setError(t`This file is not a Rakazo bot preset (export format 1).`);
      return;
    }
    setIntegrations(parsed.data.manifest.integrations);
    let cancelled = false;
    rpc.bots
      .importPreview(parsed.data)
      .then((next) => {
        if (!cancelled) setPreview(next);
      })
      .catch(() => {
        if (!cancelled) setError(t`Could not read this preset.`);
      });
    return () => {
      cancelled = true;
    };
  }, [manifest, includeMemory, includeRoutines, includeSkills, includeFiles, t]);

  async function runImport() {
    if (!manifest) return;
    const parsed = BotImportInputSchema.safeParse({
      manifest,
      includeMemory,
      includeRoutines,
      includeSkills,
      includeFiles,
    });
    if (!parsed.success) return;
    setImporting(true);
    setError(null);
    try {
      setImported(await rpc.bots.import(parsed.data));
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not import this bot`);
    } finally {
      setImporting(false);
    }
  }

  if (loading) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              <Trans>Bot library</Trans>
            </DialogTitle>
            <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label={t`Close`} />}>
              <X />
            </DialogClose>
          </DialogHeader>
          <p className="py-8 text-center text-muted-foreground">
            <Trans>Loading presets…</Trans>
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  if (imported) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              <Trans>Bot imported</Trans>
            </DialogTitle>
            <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label={t`Close`} />}>
              <X />
            </DialogClose>
          </DialogHeader>
          <div className="flex flex-col gap-4 pb-2">
            <p className="text-[14px] text-foreground">
              <Trans>
                Bot <span className="font-medium">{imported.name}</span> was created.
              </Trans>
            </p>
            <Button onClick={onClose}>
              <Trans>Done</Trans>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            <Trans>Bot library</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Start from a bot the library ships.</Trans>
          </DialogDescription>
          <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label={t`Close`} />}>
            <X />
          </DialogClose>
        </DialogHeader>

        <input
          data-testid="bot-library-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t`Search`}
          aria-label={t`Search`}
          className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm"
        />

        <div className="flex max-h-[280px] flex-col gap-2 overflow-y-auto">
          {matched.map((preset) => (
            <button
              key={preset.slug}
              type="button"
              data-testid={`preset-${preset.slug}`}
              onClick={() => setSelectedSlug(preset.slug)}
              className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-start transition-colors ${
                selectedSlug === preset.slug ? "bg-muted" : "hover:bg-accent"
              }`}
            >
              <Library size={24} strokeWidth={1.8} aria-hidden="true" className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">{preset.name}</div>
                {preset.title ? (
                  <div className="truncate text-[13px] text-muted-foreground">{preset.title}</div>
                ) : null}
                <div className="truncate text-[13px] text-muted-foreground">
                  {preset.description}
                </div>
              </div>
            </button>
          ))}
        </div>

        {matched.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-muted-foreground">
            <Trans>No presets match</Trans>
          </p>
        ) : null}

        {error ? <p className="text-[13px] text-destructive">{error}</p> : null}

        {preview ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border px-4 py-3">
            <div>
              <div className="text-[16px] text-foreground">{preview.name}</div>
              {preview.title ? (
                <div className="text-[13px] text-muted-foreground">{preview.title}</div>
              ) : null}
              <div className="text-[13px] text-muted-foreground">{preview.description}</div>
            </div>
            <div className="text-[13px] text-muted-foreground">
              <Plural
                value={preview.memoryCount}
                zero="No memories"
                one="# memory"
                other="# memories"
              />
            </div>
            {preview.routineNames.length > 0 ? (
              <div className="text-[13px] text-muted-foreground">
                <Plural
                  value={preview.routineNames.length}
                  zero="No routines"
                  one="Routine: #"
                  other="Routines: #"
                />
              </div>
            ) : null}
            {preview.skillNames.length > 0 ? (
              <div className="text-[13px] text-muted-foreground">
                <Plural value={preview.skillNames.length} one="Skill: #" other="Skills: #" />
              </div>
            ) : null}
            {integrations.length > 0 ? (
              <div className="text-[13px] text-muted-foreground">
                <Trans>Integrations</Trans>: {integrations.join(", ")}
              </div>
            ) : null}
            <div className="flex flex-col gap-2 text-[13.5px]">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeMemory}
                  onChange={(event) => setIncludeMemory(event.target.checked)}
                />
                <Trans>Include memories</Trans>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeRoutines}
                  onChange={(event) => setIncludeRoutines(event.target.checked)}
                />
                <Trans>Include routines (imported inactive)</Trans>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeSkills}
                  onChange={(event) => setIncludeSkills(event.target.checked)}
                />
                <Trans>Include skills (added to your space)</Trans>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeFiles}
                  onChange={(event) => setIncludeFiles(event.target.checked)}
                />
                <Trans>Include files</Trans>
              </label>
            </div>
            {preview.warnings.length > 0 ? (
              <ul className="flex flex-col gap-1 text-[13px] text-warning">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="py-4 text-center text-[13px] text-muted-foreground">
            <Trans>Select a preset to continue.</Trans>
          </p>
        )}

        <div className="flex justify-end gap-2 pb-2">
          <Button variant="outline" onClick={onClose} disabled={importing}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            data-testid="bot-library-import"
            disabled={!preview || importing}
            onClick={() => void runImport()}
          >
            {importing ? <Trans>Importing…</Trans> : <Trans>Import</Trans>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
