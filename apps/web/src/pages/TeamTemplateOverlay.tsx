import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { TeamTemplate } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@rakazo/ui-web";
import { Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { rpc } from "../lib/rpc";

/**
 * Create a team from a preset template (bot-library/teams/*.json).
 * Picks a template, reviews the roster, then creates the group + bots + first task.
 * Creation is server-orchestrated: one RPC call builds the whole team atomically.
 */
export function TeamTemplateOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ groupId: string; botIds: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc.teams
      .templates()
      .then((list) => {
        if (!cancelled) {
          setTemplates(list);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = templates.find((tmpl) => tmpl.id === selectedId);

  async function runCreate() {
    if (!selectedId) return;
    setCreating(true);
    setError(null);
    try {
      const result = await rpc.teams.create({
        templateId: selectedId,
        name: customName.trim() || undefined,
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
