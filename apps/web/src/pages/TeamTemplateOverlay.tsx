import type { ModelCatalogEntry, ModelCredential, TeamTemplatePlan } from "@bobbot/contracts";
import { connectedModelChoices, modelOptionKey, parseModelOptionKey } from "@bobbot/core";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bobbot/ui-web";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { rpc } from "../lib/rpc";

/** The model a plan entry names, as a picker key. Empty when nothing is connected. */
function planModelKey(entry: TeamTemplatePlan["modelPlan"][number] | undefined): string {
  return entry?.provider && entry.modelId ? modelOptionKey(entry.provider, entry.modelId) : "";
}

/**
 * Create a team from a preset template (bot-library/teams/*.json).
 * Picks a template, reviews the roster and the model each member would run on, then
 * creates the group + bots + first task. Creation is server-orchestrated: one RPC call
 * builds the whole team atomically, and a model the user changed travels with it.
 */
export function TeamTemplateOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const [templates, setTemplates] = useState<TeamTemplatePlan[]>([]);
  const [models, setModels] = useState<{
    credentials: ModelCredential[];
    catalog: ModelCatalogEntry[];
  }>({
    credentials: [],
    catalog: [],
  });
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ groupId: string; botIds: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      rpc.teams.templates(),
      rpc.models.credentials().catch(() => [] as ModelCredential[]),
      rpc.models.list().catch(() => [] as ModelCatalogEntry[]),
    ])
      .then(([list, credentials, catalog]) => {
        if (cancelled) return;
        setTemplates(list);
        setModels({ credentials, catalog });
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const choices = useMemo(
    () => connectedModelChoices(models.credentials, models.catalog),
    [models],
  );
  const selected = templates.find((tmpl) => tmpl.id === selectedId);
  const selectedChoices = useMemo(() => {
    const keys = new Set(selected?.modelPlan.map((entry) => planModelKey(entry)) ?? []);
    // Every connected model stays pickable; the space's own models come first so the
    // plan's suggestion is the near-by default in a long list.
    return [...choices].sort((a, b) => Number(keys.has(b.key)) - Number(keys.has(a.key)));
  }, [choices, selected]);

  async function runCreate() {
    if (!selectedId) return;
    setCreating(true);
    setError(null);
    // Only members the user changed travel with the request; the rest keep the plan the
    // server proposed, so a start never runs on a model that was not connected.
    const overrides = (selected?.modelPlan ?? [])
      .map((entry) => {
        const key = picks[entry.preset] ?? planModelKey(entry);
        if (!key || key === planModelKey(entry)) return null;
        const picked = parseModelOptionKey(key);
        return picked ? { preset: entry.preset, ...picked } : null;
      })
      .filter((entry): entry is { preset: string; provider: string; modelId: string } =>
        Boolean(entry),
      );
    try {
      const result = await rpc.teams.create({
        templateId: selectedId,
        name: customName.trim() || undefined,
        ...(overrides.length ? { models: overrides } : {}),
      });
      setCreated({ groupId: result.group.id, botIds: result.bots.map((b) => b.id) });
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not create team`);
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              <Trans>Team from template</Trans>
            </DialogTitle>
            <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label={t`Close`} />}>
              <X />
            </DialogClose>
          </DialogHeader>
          <p className="text-muted-foreground py-8 text-center">
            <Trans>Loading templates…</Trans>
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  if (created) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              <Trans>Team created</Trans>
            </DialogTitle>
            <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label={t`Close`} />}>
              <X />
            </DialogClose>
          </DialogHeader>
          <div className="flex flex-col gap-4 pb-2">
            <p className="text-[14px] text-foreground">
              <Trans>
                Team <span className="font-medium">{selected?.label ?? selectedId}</span> created
                with <Plural value={created.botIds.length} one="# bot" other="# bots" />
                and a group.
              </Trans>
            </p>
            {selected?.integrations.length ? (
              <p className="text-[13px] text-muted-foreground">
                <Trans>Integrations</Trans>: {selected.integrations.join(", ")}
              </p>
            ) : null}
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
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            <Trans>Team from template</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Pick a starter roster. The lead bot receives the first task automatically.
            </Trans>
          </DialogDescription>
          <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label={t`Close`} />}>
            <X />
          </DialogClose>
        </DialogHeader>

        {error ? <p className="text-[13px] text-destructive mb-2">{error}</p> : null}

        <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto">
          {templates.map((tmpl) => (
            <button
              key={tmpl.id}
              type="button"
              onClick={() => setSelectedId(tmpl.id)}
              className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-start transition-colors ${
                selectedId === tmpl.id ? "bg-muted" : "hover:bg-accent"
              }`}
            >
              <Users size={24} strokeWidth={1.8} aria-hidden="true" className="shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground truncate">{tmpl.label}</div>
                <div className="text-[13px] text-muted-foreground truncate">{tmpl.summary}</div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[12px] text-muted-foreground">
                  {tmpl.members.map((m, idx) => (
                    <span key={m.preset} className="px-1.5 py-0.5 rounded bg-muted/50">
                      {idx === 0 ? "★ " : ""}
                      {m.preset} <span className="text-muted">{m.role}</span>
                    </span>
                  ))}
                </div>
              </div>
            </button>
          ))}
        </div>

        {templates.length === 0 ? (
          <p className="text-[13px] text-muted-foreground text-center py-4">
            <Trans>No team templates available.</Trans>
          </p>
        ) : null}

        {selected ? (
          <>
            <div className="mt-4 flex flex-col gap-2 rounded-xl border border-border px-3 py-2">
              <div className="text-sm text-muted-foreground">
                <Trans>Model per member</Trans>
              </div>
              {selected.modelPlan.map((entry) => {
                const planKey = planModelKey(entry);
                const value = picks[entry.preset] ?? planKey;
                const role = selected.members.find(
                  (member) => member.preset === entry.preset,
                )?.role;
                return (
                  <label
                    key={entry.preset}
                    className="flex items-center justify-between gap-2 text-[13px]"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {entry.preset}{" "}
                      {role ? <span className="text-muted-foreground">{role}</span> : null}
                    </span>
                    <select
                      value={value}
                      onChange={(event) =>
                        setPicks((current) => ({ ...current, [entry.preset]: event.target.value }))
                      }
                      className="max-w-[55%] rounded border border-input bg-background px-2 py-1 text-[12px]"
                    >
                      {planKey ? null : (
                        <option value="">
                          {entry.source === "none" ? (
                            <Trans>Run on the space default</Trans>
                          ) : (
                            <Trans>Space default</Trans>
                          )}
                        </option>
                      )}
                      {planKey && !selectedChoices.some((choice) => choice.key === planKey) ? (
                        <option value={planKey}>{entry.modelId}</option>
                      ) : null}
                      {selectedChoices.map((choice) => (
                        <option key={choice.key} value={choice.key}>
                          {choice.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
            <div className="mt-4 rounded-xl border border-border px-3 py-2">
              <label htmlFor="team-name" className="block text-sm text-muted-foreground">
                <Trans>Group name (optional)</Trans>
                <input
                  id="team-name"
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder={selected.label}
                  className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-sm"
                  maxLength={80}
                />
              </label>
            </div>
            {selected.integrations.length > 0 ? (
              <p className="text-[13px] text-muted-foreground">
                <Trans>Integrations</Trans>: {selected.integrations.join(", ")}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={creating}>
                <Trans>Cancel</Trans>
              </Button>
              <Button disabled={creating || !selectedId} onClick={() => void runCreate()}>
                {creating ? <Trans>Creating…</Trans> : <Trans>Create team</Trans>}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground text-center py-4">
            <Trans>Select a template to continue.</Trans>
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
