import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { Bot, ImportPreview } from "@rakazo/contracts";
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
import { Upload, X } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { rpc } from "../lib/rpc";

const PRESET_ACCEPT = "application/json,.json";

/**
 * Import a bot preset (export manifest v1) into a new bot.
 * Pick a JSON file, review the preview, then import. Import failures surface
 * inline; the picked file stays loaded so retrying never loses the selection.
 */
export function BotImportOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [manifestJson, setManifestJson] = useState<string | null>(null);
  const [includeMemory, setIncludeMemory] = useState(true);
  const [includeRoutines, setIncludeRoutines] = useState(true);
  const [includeSkills, setIncludeSkills] = useState(true);
  const [includeFiles, setIncludeFiles] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [integrations, setIntegrations] = useState<string[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<Bot | null>(null);

  useEffect(() => {
    if (!manifestJson) {
      setPreview(null);
      setIntegrations([]);
      setParseError(null);
      return;
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestJson);
    } catch {
      setParseError(t`That file is not valid JSON.`);
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
      setParseError(t`This file is not a Rakazo bot preset (export format 1).`);
      return;
    }
    setParseError(null);
    setIntegrations(parsed.data.manifest.integrations);
    let cancelled = false;
    rpc.bots
      .importPreview(parsed.data)
      .then((nextPreview) => {
        if (!cancelled) setPreview(nextPreview);
      })
      .catch(() => {
        if (!cancelled) setParseError(t`Could not read this preset.`);
      });
    return () => {
      cancelled = true;
    };
  }, [manifestJson, includeMemory, includeRoutines, includeSkills, includeFiles, t]);

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setImported(null);
    setFileName(file.name);
    setManifestJson(await file.text());
  }

  async function runImport() {
    if (!manifestJson) return;
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestJson);
    } catch {
      setParseError(t`That file is not valid JSON.`);
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
      setParseError(t`This file is not a Rakazo bot preset (export format 1).`);
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const bot = await rpc.bots.import(parsed.data);
      setImported(bot);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not import this bot`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            <Trans>Import bot</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Load a bot from an exported preset file.</Trans>
          </DialogDescription>
          <DialogClose
            render={<Button variant="ghost" size="icon-sm" aria-label={t`Close import`} />}
          >
            <X />
          </DialogClose>
        </DialogHeader>

        {imported ? (
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
        ) : (
          <>
            <label
              htmlFor="bot-import-file"
              onDragOver={(event) => event.preventDefault()}
              onDrop={async (event) => {
                event.preventDefault();
                const file = event.dataTransfer.files?.[0];
                if (!file) return;
                setError(null);
                setImported(null);
                setFileName(file.name);
                setManifestJson(await file.text());
              }}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-center hover:bg-accent"
            >
              <Upload size={20} className="text-muted-foreground" aria-hidden="true" />
              <span className="text-[14px] text-foreground">
                {fileName ? fileName : <Trans>Drop a preset file here, or click to choose</Trans>}
              </span>
              <input
                ref={fileInputRef}
                id="bot-import-file"
                type="file"
                accept={PRESET_ACCEPT}
                className="sr-only"
                onChange={(event) => void pickFile(event)}
              />
            </label>

            {parseError ? <p className="text-[13px] text-destructive">{parseError}</p> : null}

            {preview ? (
              <div className="flex flex-col gap-3 rounded-xl border border-border px-4 py-3">
                <div>
                  <div className="text-[16px] text-foreground">{preview.name}</div>
                  {preview.title ? (
                    <div className="text-[13px] text-muted-foreground">{preview.title}</div>
                  ) : null}
                </div>
                <Plural
                  value={preview.memoryCount}
                  zero="No memories"
                  one="# memory"
                  other="# memories"
                />
                <div className="text-[13px] text-muted-foreground">
                  {preview.routineNames.length > 0 ? (
                    <Plural
                      value={preview.routineNames.length}
                      zero="No routines"
                      one="Routine: #"
                      other="Routines: #"
                    />
                  ) : null}
                </div>
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
            ) : null}

            {error ? <p className="text-[13px] text-destructive">{error}</p> : null}

            <div className="flex justify-end gap-2 pb-2">
              <Button variant="outline" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button disabled={!preview || importing} onClick={() => void runImport()}>
                {importing ? <Trans>Importing…</Trans> : <Trans>Import</Trans>}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
