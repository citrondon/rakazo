import type {
  TriggerEvent,
  TriggerFilter,
  TriggerMapping,
  TriggerPredicate,
} from "@rakazo/contracts";

/**
 * Evaluates a trigger's filter against a normalized event and maps event fields onto
 * routine inputs. Pure and deterministic: no I/O, no clock, no network, so the same event
 * and filter always produce the same decision. Provider adapters build the `TriggerEvent`.
 */

const EVENT_ROOT = "event.";

/** Resolve a dot path against the event (`payload.issue.title`, `event.payload.repo`). */
export function resolveEventField(event: TriggerEvent, path: string): unknown {
  const trimmed = path.startsWith(EVENT_ROOT) ? path.slice(EVENT_ROOT.length) : path;
  let current: unknown = event;
  for (const segment of trimmed.split(".")) {
    if (segment.length === 0) continue;
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function asText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return null;
}

function fold(text: string, caseSensitive: boolean): string {
  return caseSensitive ? text : text.toLowerCase();
}

function equalsAny(value: unknown, options: readonly string[], caseSensitive: boolean): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => {
      const text = asText(item);
      return (
        text !== null && options.some((o) => fold(o, caseSensitive) === fold(text, caseSensitive))
      );
    });
  }
  const text = asText(value);
  return text !== null && options.some((o) => fold(o, caseSensitive) === fold(text, caseSensitive));
}

/** True when the event field satisfies the predicate. Invalid regexes never match. */
export function evaluatePredicate(predicate: TriggerPredicate, event: TriggerEvent): boolean {
  const actual = resolveEventField(event, predicate.field);
  const caseSensitive = predicate.caseSensitive ?? false;

  switch (predicate.operator) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "oneOf":
      return equalsAny(
        actual,
        Array.isArray(predicate.value) ? predicate.value : [],
        caseSensitive,
      );
    case "equals":
      return (
        typeof predicate.value === "string" && equalsAny(actual, [predicate.value], caseSensitive)
      );
    case "contains": {
      const needle = typeof predicate.value === "string" ? predicate.value : "";
      if (needle.length === 0) return false;
      if (Array.isArray(actual)) return equalsAny(actual, [needle], caseSensitive);
      const text = asText(actual);
      return text !== null && fold(text, caseSensitive).includes(fold(needle, caseSensitive));
    }
    case "startsWith": {
      if (typeof predicate.value !== "string") return false;
      const text = asText(actual);
      return (
        text !== null && fold(text, caseSensitive).startsWith(fold(predicate.value, caseSensitive))
      );
    }
    case "endsWith": {
      if (typeof predicate.value !== "string") return false;
      const text = asText(actual);
      return (
        text !== null && fold(text, caseSensitive).endsWith(fold(predicate.value, caseSensitive))
      );
    }
    case "regex": {
      if (typeof predicate.value !== "string") return false;
      const text = asText(actual);
      if (text === null) return false;
      try {
        return new RegExp(predicate.value, caseSensitive ? "" : "i").test(text);
      } catch {
        return false;
      }
    }
    case "gt":
      return typeof actual === "number" && typeof predicate.value === "number" && actual > predicate.value;
    case "lt":
      return typeof actual === "number" && typeof predicate.value === "number" && actual < predicate.value;
    case "gte":
      return typeof actual === "number" && typeof predicate.value === "number" && actual >= predicate.value;
    case "lte":
      return typeof actual === "number" && typeof predicate.value === "number" && actual <= predicate.value;
    default:
      return false;
  }
}

/**
 * Every predicate must pass. An empty filter matches nothing: a trigger is expected to be
 * narrow, and a listener that fires on every event is the noise the routine guidance warns
 * about. Use `isOverlyBroadTrigger` to warn before an empty filter is even created.
 */
export function matchesTriggerFilter(filter: TriggerFilter, event: TriggerEvent): boolean {
  if (filter.predicates.length === 0) return false;
  return filter.predicates.every((predicate) => evaluatePredicate(predicate, event));
}

/** True when a filter has no rules and would therefore never fire (or fire on everything). */
export function isOverlyBroadTrigger(filter: TriggerFilter): boolean {
  return filter.predicates.length === 0;
}

function stringifyEventValue(value: unknown): string | null {
  const text = asText(value);
  if (text !== null) return text;
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve each mapping from the event into a routine input. Missing fields are omitted
 * rather than sent as empty strings, so a prompt can tell "no value" from "empty value".
 */
export function applyTriggerMappings(
  mappings: readonly TriggerMapping[],
  event: TriggerEvent,
): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const mapping of mappings) {
    const value = stringifyEventValue(resolveEventField(event, mapping.from));
    if (value !== null) inputs[mapping.to] = value;
  }
  return inputs;
}
