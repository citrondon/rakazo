import type {
  EventDefinition,
  Trigger,
  TriggerOperator,
  TriggerPredicate,
  TrustEffect,
} from "@bobbot/contracts";
import { Badge, Button, Input, NativeSelect, NativeSelectOption } from "@bobbot/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { rpc } from "../lib/rpc";

const OPERATORS: TriggerOperator[] = [
  "equals",
  "contains",
  "startsWith",
  "endsWith",
  "oneOf",
  "regex",
  "exists",
  "gt",
  "lt",
  "gte",
  "lte",
];

/** These operators bound a number instead of matching text. */
const NUMERIC_OPERATORS: TriggerOperator[] = ["gt", "lt", "gte", "lte"];

/** Risk tier to a monochrome badge; only the top tier borrows the status color. */
const RISK_VARIANT: Record<TrustEffect["risk"], "destructive" | "outline" | "secondary"> = {
  high: "destructive",
  medium: "outline",
  low: "secondary",
};

function effectLabel(effect: TrustEffect): string {
  return `${effect.target} · ${effect.action}`;
}

function eventLabel(trigger: Trigger, catalog: EventDefinition[]): string {
  const match =
    catalog.find(
      (entry) => entry.provider === trigger.provider && entry.type === trigger.eventType,
    ) ?? catalog.find((entry) => entry.provider === trigger.provider);
  return match?.label ?? `${trigger.provider}${trigger.eventType ? `:${trigger.eventType}` : ""}`;
}

/** A one-line summary of the trigger's rule, for the list row. */
export function triggerSummary(trigger: Trigger, catalog: EventDefinition[]): string {
  const label = eventLabel(trigger, catalog);
  const rule = trigger.filter.predicates[0];
  if (!rule) return label;
  if (rule.operator === "exists") return `${label} · ${rule.field}`;
  const value = Array.isArray(rule.value) ? rule.value.join(", ") : (rule.value ?? "");
  return `${label} · ${rule.field} ${rule.operator} ${value}`.trim();
}

/**
 * Reactive triggers for one routine, self-contained: it loads its own catalog and triggers so a
 * routine editor only needs the routine id. A trigger narrows the routine's inbound events to the
 * ones its rule matches; the inbound flags on the routine stay the delivery path.
 */
export function ReactiveTriggerSection({ routineId }: { routineId: string }) {
  const { t } = useLingui();
  const [loading, setLoading] = useState(true);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [catalog, setCatalog] = useState<EventDefinition[]>([]);
  const [effects, setEffects] = useState<TrustEffect[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventId, setEventId] = useState("");
  const [field, setField] = useState("");
  const [operator, setOperator] = useState<TriggerOperator>("equals");
  const [value, setValue] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const [list, events, preview] = await Promise.all([
        rpc.triggers.list({ routineId }),
        rpc.events.list(),
        rpc.triggers.previewEffects({ routineId }),
      ]);
      setTriggers(list);
      setCatalog(events);
      setEffects(preview);
      setError(null);
    } catch {
      setError(t`Could not load triggers`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [routineId]);

  const selected = catalog.find((entry) => entry.id === eventId) ?? null;

  function predicateFor(): TriggerPredicate {
    const predicateField = field || selected?.fields[0] || "payload";
    if (operator === "exists") return { field: predicateField, operator, caseSensitive: false };
    const predicateValue =
      operator === "oneOf"
        ? value
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
        : value;
    return { field: predicateField, operator, value: predicateValue, caseSensitive: false };
  }

  async function create() {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await rpc.triggers.create({
        routineId,
        source: selected.source,
        provider: selected.provider,
        eventType: selected.type,
        filter: { predicates: [predicateFor()] },
        mappings: [],
        enabled: true,
      });
      setAdding(false);
      setEventId("");
      setField("");
      setValue("");
      await refresh();
    } catch {
      setError(t`Could not add the trigger`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(triggerId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await rpc.triggers.remove({ triggerId });
      await refresh();
    } catch {
      setError(t`Could not remove the trigger`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-5 text-sm text-muted-foreground" data-testid="reactive-triggers">
      <div className="flex items-baseline justify-between gap-2">
        <Trans>Reactive triggers</Trans>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`Add trigger`}
          disabled={busy}
          onClick={() => setAdding((open) => !open)}
        >
          <Plus strokeWidth={1.9} />
        </Button>
      </div>

      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
      {loading ? (
        <p className="mt-2 text-[13.5px] text-muted-foreground/80">
          <Trans>Loading…</Trans>
        </p>
      ) : null}

      {!loading && triggers.length === 0 ? (
        <p className="mt-2 text-[13.5px] text-muted-foreground/80">
          <Trans>No reactive triggers yet. The routine runs on every matched event.</Trans>
        </p>
      ) : null}

      {!loading && effects.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          <p className="text-[13px] text-muted-foreground/80">
            <Trans>Planned effects</Trans>
          </p>
          {effects.map((effect) => (
            <div
              key={`${effect.action}:${effect.target}`}
              className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2"
            >
              <Badge variant={RISK_VARIANT[effect.risk]}>{effect.risk}</Badge>
              <span className="min-w-0 flex-1 truncate text-[14px] text-foreground" dir="auto">
                {effectLabel(effect)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-2 space-y-2">
        {triggers.map((trigger) => (
          <div
            key={trigger.id}
            className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2.5"
          >
            <span className="min-w-0 flex-1 truncate text-[14px] text-foreground" dir="auto">
              {triggerSummary(trigger, catalog)}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t`Remove trigger`}
              disabled={busy}
              onClick={() => void remove(trigger.id)}
              className="text-muted-foreground"
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="mt-3 space-y-2 rounded-xl border border-border p-3">
          <NativeSelect
            aria-label={t`Event`}
            value={eventId}
            onChange={(event) => {
              setEventId(event.target.value);
              setField("");
            }}
          >
            <NativeSelectOption value="">{t`Choose an event`}</NativeSelectOption>
            {catalog.map((entry) => (
              <NativeSelectOption key={entry.id} value={entry.id}>
                {entry.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>

          {selected ? (
            <>
              <NativeSelect
                aria-label={t`Field`}
                value={field || selected.fields[0] || ""}
                onChange={(event) => setField(event.target.value)}
              >
                {selected.fields.map((name) => (
                  <NativeSelectOption key={name} value={name}>
                    {name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>

              <NativeSelect
                aria-label={t`Operator`}
                value={operator}
                onChange={(event) => setOperator(event.target.value as TriggerOperator)}
              >
                {OPERATORS.map((name) => (
                  <NativeSelectOption key={name} value={name}>
                    {name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>

              {operator !== "exists" ? (
                <Input
                  aria-label={t`Value`}
                  value={value}
                  placeholder={
                    operator === "oneOf"
                      ? t`a, b, c`
                      : NUMERIC_OPERATORS.includes(operator)
                        ? t`Number to compare`
                        : t`Value to match`
                  }
                  onChange={(event) => setValue(event.target.value)}
                />
              ) : null}

              <div className="flex gap-2">
                <Button disabled={busy} onClick={() => void create()}>
                  <Trans>Add trigger</Trans>
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setAdding(false)}>
                  <Trans>Cancel</Trans>
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
