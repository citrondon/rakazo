import { listEventDefinitions } from "@rakazo/adapters";
import type { Actor, CreateTriggerInput, UpdateTriggerInput } from "@rakazo/contracts";
import { planRoutineEffects } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { createRoutineToolRepos, createTriggerRepos, IsolationError } from "@rakazo/db";

export type TriggerDeps = { prisma: PrismaClient };

/**
 * The discoverable events a trigger can listen for. Provider-neutral data with no per-actor
 * state, exposed so any surface can render a trigger picker from one source of truth.
 */
export function listEvents() {
  return listEventDefinitions();
}

/**
 * Reactive triggers for routines. Creating a trigger also enables the routine's inbound flag
 * for the paths that exist today (a webhook or GitHub delivery), so a trigger is enough on its
 * own; a messaging trigger refines a routine already wired to its message provider. Other
 * connector providers are stored and filtered, but their inbound path is future work.
 */
export async function createTrigger(deps: TriggerDeps, actor: Actor, input: CreateTriggerInput) {
  const trigger = await createTriggerRepos(deps.prisma).createTrigger(actor, input);
  if (input.source === "webhook") {
    await deps.prisma.routine.update({
      where: { id: trigger.routineId },
      data: { webhookEnabled: true },
    });
  } else if (input.provider === "github") {
    await deps.prisma.routine.update({
      where: { id: trigger.routineId },
      data: { githubEnabled: true },
    });
  }
  return trigger;
}

export function listTriggers(deps: TriggerDeps, actor: Actor, session: { routineId: string }) {
  return createTriggerRepos(deps.prisma).listTriggers(actor, session.routineId);
}

export function updateTrigger(deps: TriggerDeps, actor: Actor, input: UpdateTriggerInput) {
  return createTriggerRepos(deps.prisma).updateTrigger(actor, input);
}

export async function deleteTrigger(deps: TriggerDeps, actor: Actor, input: { triggerId: string }) {
  await createTriggerRepos(deps.prisma).deleteTrigger(actor, input.triggerId);
  return { ok: true as const };
}

/**
 * The effects a routine's triggered runs may reach, derived from its bot's reachable tools. A
 * read-only preview for the editor: it shows the risk tiers before anyone lets an unattended
 * run proceed, from the same planner the wake path uses (one source of truth).
 */
export async function previewEffects(
  deps: TriggerDeps,
  actor: Actor,
  input: { routineId: string },
) {
  const routine = await deps.prisma.routine.findFirst({
    where: { id: input.routineId, spaceId: actor.spaceId, userId: actor.userId },
    select: { id: true },
  });
  if (!routine) throw new IsolationError();
  const descriptors = await createRoutineToolRepos(deps.prisma).listBotToolDescriptors({
    spaceId: actor.spaceId,
    userId: actor.userId,
  });
  return planRoutineEffects(descriptors);
}
