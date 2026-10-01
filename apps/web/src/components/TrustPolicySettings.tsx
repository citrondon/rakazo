import { Trans, useLingui } from "@lingui/react/macro";
import type { TrustPolicy, TrustRisk } from "@rakazo/contracts";
import { Input, Label, NativeSelect, NativeSelectOption, Switch } from "@rakazo/ui-web";
import { useEffect, useId, useState } from "react";
import { rpc } from "../lib/rpc";

const THRESHOLDS: TrustRisk[] = ["low", "medium", "high"];

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Per-space trust policy: the risk tier that pauses a triggered routine for a person, and the
 * quiet window that holds consequential work. Saves on change; the value only exists once a
 * space opts in, so a fresh space starts at the safe default.
 */
export function TrustPolicySettings() {
  const { t } = useLingui();
  const quietId = useId();
  const [policy, setPolicy] = useState<TrustPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void rpc.trust
      .get()
      .then((loaded) => {
        if (!cancelled) setPolicy(loaded);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t`Could not load trust settings`);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: TrustPolicy) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      setPolicy(await rpc.trust.set(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not save trust settings`);
    } finally {
      setSaving(false);
    }
  }

  const quiet = policy?.quietHours ?? null;

  return (
    <div data-testid="trust-policy-settings" className="mt-5 border-t border-border pt-5">
      <h3 className="text-[15px] font-medium text-foreground">
        <Trans>Unattended runs</Trans>
      </h3>
      <div className="mt-4 flex items-center gap-3">
        <Label
          htmlFor={`${quietId}-threshold`}
          className="text-[14px] font-normal text-foreground/75"
        >
          <Trans>Ask for</Trans>
        </Label>
        <NativeSelect
          id={`${quietId}-threshold`}
          aria-label={t`Approval threshold`}
          value={policy?.approvalThreshold ?? "medium"}
          disabled={loading || saving || !policy}
          onChange={(event) => {
            if (policy)
              void save({ ...policy, approvalThreshold: event.target.value as TrustRisk });
          }}
        >
          {THRESHOLDS.map((risk) => (
            <NativeSelectOption key={risk} value={risk}>
              {risk}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <div className="mt-4 flex items-start gap-3">
        <Switch
          id={quietId}
          className="mt-0.5"
          checked={quiet !== null}
          disabled={loading || saving || !policy}
          onCheckedChange={(checked) => {
            if (!policy) return;
            void save({
              ...policy,
              quietHours: checked
                ? { start: "22:00", end: "07:00", timezone: browserTimezone() }
                : null,
            });
          }}
        />
        <div className="flex-1">
          <Label htmlFor={quietId} className="text-[14px] font-normal text-foreground/75">
            <Trans>Pause unattended runs at night</Trans>
          </Label>
          {quiet ? (
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="time"
                aria-label={t`Quiet hours start`}
                value={quiet.start}
                disabled={saving}
                className="w-[7rem]"
                onChange={(event) => {
                  if (!policy) return;
                  void save({ ...policy, quietHours: { ...quiet, start: event.target.value } });
                }}
              />
              <Input
                type="time"
                aria-label={t`Quiet hours end`}
                value={quiet.end}
                disabled={saving}
                className="w-[7rem]"
                onChange={(event) => {
                  if (!policy) return;
                  void save({ ...policy, quietHours: { ...quiet, end: event.target.value } });
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
      {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}
