import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { Bot, BotPresetSummary, ExportManifest, ImportPreview } from "@rakazo/contracts";
import { BotImportInputSchema } from "@rakazo/contracts";
import {
  BotAvatar,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  GROK_BOT_COLORS,
} from "@rakazo/ui-web";
import { Library, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PresetBoundaries } from "../components/PresetBoundaries";
import { rpc } from "../lib/rpc";

type PresetCategory =
  | "productivity"
  | "engineering"
  | "research"
  | "sales"
  | "creative"
  | "personal";

const PRESET_CATEGORIES: Record<PresetCategory, string[]> = {
  productivity: [
    "bot-team-coach",
    "chief-of-staff",
    "daily-brief",
    "executive-chief",
    "focus-defender",
    "meeting-notes",
    "meeting-prep",
    "new-hire-ramp",
    "one-to-one-brief",
    "slack-noise-filter",
    "standup-desk",
    "what-did-we-promise",
  ],
  engineering: [
    "bug-reproduction",
    "changelog-bot",
    "deploy-watch",
    "grok-coder",
    "issue-drafter",
    "pr-reviewer",
    "query-helper",
    "repo-hardener",
    "security-auditor",
  ],
  research: [
    "cloud-spend",
    "competitor-watch",
    "data-analyst",
    "feature-ask-finder",
    "openresearch",
    "trend-scout",
    "product-analytics",
    "product-performance",
    "reading-digest",
    "reddit-comment-finder",
  ],
  sales: [
    "account-desk",
    "account-health",
    "call-followup",
    "contact-crm",
    "churn-watch",
    "incident-desk",
    "inbox-triage",
    "outbound-voice",
    "proposal-desk",
    "qbr-pack-builder",
    "resume-screen",
    "saas-finance",
    "security-questionnaire",
    "vendor-inbox",
    "win-loss",
    "support-desk",
    "support-replies",
    "talent-scout",
  ],
  creative: [
    "brand-watch",
    "content-remix",
    "docs-writer",
    "linkedin-signal-watch",
    "newsletter-desk",
    "paid-media",
    "seo-pages",
    "social-queue",
    "viral-tweet-scout",
  ],
  personal: [
    "charge-dispute-draft",
    "expense-manager",
    "household-ops",
    "profile-review",
    "subscription-pruner",
    "trip-concierge",
  ],
};

function categoryForPreset(slug: string): PresetCategory {
  return (
    (Object.entries(PRESET_CATEGORIES).find(([, slugs]) => slugs.includes(slug))?.[0] as
      | PresetCategory
      | undefined) ?? "productivity"
  );
}

function avatarColorForPreset(slug: string): string {
  let hash = 2166136261;
  for (const character of slug) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return GROK_BOT_COLORS[(hash >>> 0) % GROK_BOT_COLORS.length] ?? GROK_BOT_COLORS[0] ?? "#8B5CF6";
}

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
  const [selectedCategory, setSelectedCategory] = useState<"all" | PresetCategory>("all");
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

  const categoryOptions: Array<{ id: "all" | PresetCategory; label: string }> = [
    { id: "all", label: t`All bots` },
    { id: "productivity", label: t`Productivity` },
    { id: "engineering", label: t`Engineering` },
    { id: "research", label: t`Research` },
    { id: "sales", label: t`Sales & support` },
    { id: "creative", label: t`Writing & marketing` },
    { id: "personal", label: t`Personal` },
  ];
  const needle = query.trim().toLowerCase();
  const matched = useMemo(() => {
    return presets.filter((preset) => {
      const category = categoryForPreset(preset.slug);
      const matchesCategory = selectedCategory === "all" || category === selectedCategory;
      const matchesQuery =
        !needle ||
        `${preset.name} ${preset.title} ${preset.description} ${category}`
          .toLowerCase()
          .includes(needle);
      return matchesCategory && matchesQuery;
    });
  }, [presets, needle, selectedCategory]);

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
        <DialogContent showCloseButton={false} className="sm:max-w-[520px]">
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
        <DialogContent showCloseButton={false} className="sm:max-w-[520px]">
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
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(88vh,800px)] flex-col overflow-hidden sm:max-w-[760px]"
      >
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

        <div className="flex flex-col gap-3">
          <input
            data-testid="bot-library-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t`Search bots`}
            aria-label={t`Search bots`}
            className="w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm"
          />
          <fieldset
            aria-label={t`Bot categories`}
            className="flex min-w-0 gap-2 overflow-x-auto border-0 p-0 pb-1"
          >
            {categoryOptions.map((category) => {
              const count =
                category.id === "all"
                  ? presets.length
                  : presets.filter((preset) => categoryForPreset(preset.slug) === category.id)
                      .length;
              return (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={selectedCategory === category.id}
                  data-testid={`bot-category-${category.id}`}
                  onClick={() => setSelectedCategory(category.id)}
                  className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
                    selectedCategory === category.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {category.label}
                  <span className="tabular-nums opacity-70">{count}</span>
                </button>
              );
            })}
          </fieldset>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {matched.map((preset) => {
                const category = categoryOptions.find(
                  (item) => item.id === categoryForPreset(preset.slug),
                );
                return (
                  <button
                    key={preset.slug}
                    type="button"
                    data-testid={`preset-${preset.slug}`}
                    aria-pressed={selectedSlug === preset.slug}
                    onClick={() => setSelectedSlug(preset.slug)}
                    className={`flex min-w-0 items-center gap-3 rounded-2xl border p-3 text-start transition-colors ${
                      selectedSlug === preset.slug
                        ? "border-foreground bg-accent"
                        : "border-border bg-card hover:bg-accent"
                    }`}
                  >
                    <BotAvatar
                      color={avatarColorForPreset(preset.slug)}
                      identity={preset.slug}
                      size={42}
                      className="shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-foreground">
                        {preset.name}
                      </span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {preset.title || preset.description}
                      </span>
                      {category ? (
                        <span className="mt-1 block truncate text-[11px] text-muted-foreground/80">
                          {category.label}
                        </span>
                      ) : null}
                    </span>
                    <Library
                      size={15}
                      strokeWidth={1.8}
                      aria-hidden="true"
                      className="shrink-0 text-muted-foreground/70"
                    />
                  </button>
                );
              })}
            </div>

            {matched.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border py-8 text-center text-[13px] text-muted-foreground">
                <Trans>No bots in this category match your search.</Trans>
              </p>
            ) : null}

            {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
          </div>

          <div className="max-h-[min(46vh,340px)] shrink-0 overflow-y-auto">
            {preview ? (
              <div className="flex flex-col gap-3 rounded-xl border border-border px-4 py-3">
                <div>
                  <div className="text-[16px] text-foreground">{preview.name}</div>
                  {preview.title ? (
                    <div className="text-[13px] text-muted-foreground">{preview.title}</div>
                  ) : null}
                  <div className="text-[13px] text-muted-foreground">{preview.description}</div>
                </div>
                <PresetBoundaries boundaries={preview.boundaries} />
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
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
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
