import type { Trigger, TriggerEvent } from "@rakazo/contracts";
import { applyTriggerMappings, matchesTriggerFilter } from "./trigger-filter.js";

/**
 * Narrows the routines an inbound event may wake. Given the routines a legacy flag already
 * selected and the triggers stored for those routines, a routine with no enabled trigger for
 * this event keeps its legacy behavior, while a routine that does have triggers fires only
 * when at least one matches — so a trigger refines, never broadens, what an event can wake.
 * Pure and offline so the decision is testable without a provider or a computer.
 */

export type TriggerCandidate = { routineId: string; name: string; prompt: string };
export type TriggeredRoutine = { name: string; prompt: string };

/** Render mapped event fields as a short block appended to a routine prompt. */
export function formatRoutineInputs(inputs: Record<string, string>): string {
  const entries = Object.entries(inputs);
  if (entries.length === 0) return "";
  return ["Routine inputs:", ...entries.map(([key, value]) => `- ${key}: ${value}`)].join("\n");
}

export function selectTriggeredRoutines(
  candidates: readonly TriggerCandidate[],
  triggers: readonly Trigger[],
  event: TriggerEvent,
): TriggeredRoutine[] {
  const byRoutine = new Map<string, Trigger[]>();
  for (const trigger of triggers) {
    if (!trigger.enabled) continue;
    const list = byRoutine.get(trigger.routineId) ?? [];
    list.push(trigger);
    byRoutine.set(trigger.routineId, list);
  }

  const selected: TriggeredRoutine[] = [];
  for (const candidate of candidates) {
    const routineTriggers = byRoutine.get(candidate.routineId);
    if (!routineTriggers || routineTriggers.length === 0) {
      selected.push({ name: candidate.name, prompt: candidate.prompt });
      continue;
    }
    const matching = routineTriggers.filter((trigger) =>
      matchesTriggerFilter(trigger.filter, event),
    );
    if (matching.length === 0) continue;
    const inputs: Record<string, string> = {};
    for (const trigger of matching) {
      Object.assign(inputs, applyTriggerMappings(trigger.mappings, event));
    }
    const block = formatRoutineInputs(inputs);
    selected.push({
      name: candidate.name,
      prompt: block ? `${candidate.prompt.trim()}\n\n${block}` : candidate.prompt,
    });
  }
  return selected;
}
