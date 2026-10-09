import type {
  Actor,
  CreateTriggerInput,
  Trigger,
  TriggerFilter,
  TriggerMapping,
  TriggerSource,
  UpdateTriggerInput,
} from "@bobbot/contracts";
import type { Prisma, PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";

type TriggerRecord = {
  id: string;
  routineId: string;
  botId: string;
  source: string;
  provider: string;
  eventType: string | null;
  filter: unknown;
  mappings: unknown;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function mapTrigger(record: TriggerRecord): Trigger {
  return {
    id: record.id,
    routineId: record.routineId,
    botId: record.botId,
    source: record.source as TriggerSource,
    provider: record.provider,
    eventType: record.eventType,
    filter: (record.filter ?? { predicates: [] }) as TriggerFilter,
    mappings: (record.mappings ?? []) as TriggerMapping[],
    enabled: record.enabled,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * Reactive triggers for routines. Every read and write is scoped to the actor's space and
 * user, and a trigger's bot is always derived from its routine so a caller cannot point a
 * rule at another bot. Provider payloads are normalized elsewhere; this layer only stores
 * the narrow rule and its field mappings.
 */
export function createTriggerRepos(prisma: PrismaClient) {
  async function findOwned(actor: Actor, triggerId: string): Promise<{ id: string }> {
    const existing = await prisma.trigger.findFirst({
      where: { id: triggerId, spaceId: actor.spaceId, userId: actor.userId },
      select: { id: true },
    });
    if (!existing) throw new IsolationError();
    return existing;
  }

  return {
    async createTrigger(actor: Actor, input: CreateTriggerInput): Promise<Trigger> {
      const routine = await prisma.routine.findFirst({
        where: { id: input.routineId, spaceId: actor.spaceId, userId: actor.userId },
        select: { id: true, botId: true },
      });
      if (!routine) throw new IsolationError();
      const row = await prisma.trigger.create({
        data: {
          spaceId: actor.spaceId,
          routineId: routine.id,
          botId: routine.botId,
          userId: actor.userId,
          source: input.source,
          provider: input.provider,
          eventType: input.eventType,
          filter: input.filter as Prisma.InputJsonValue,
          mappings: input.mappings as Prisma.InputJsonValue,
          enabled: input.enabled,
        },
      });
      return mapTrigger(row as TriggerRecord);
    },

    async listTriggers(actor: Actor, routineId: string): Promise<Trigger[]> {
      const rows = await prisma.trigger.findMany({
        where: { spaceId: actor.spaceId, userId: actor.userId, routineId },
        orderBy: { createdAt: "asc" },
      });
      return (rows as TriggerRecord[]).map(mapTrigger);
    },

    async updateTrigger(actor: Actor, input: UpdateTriggerInput): Promise<Trigger> {
      await findOwned(actor, input.triggerId);
      const data: Prisma.TriggerUpdateInput = {};
      if (input.enabled !== undefined) data.enabled = input.enabled;
      if (input.eventType !== undefined) data.eventType = input.eventType;
      if (input.filter !== undefined) data.filter = input.filter as Prisma.InputJsonValue;
      if (input.mappings !== undefined) data.mappings = input.mappings as Prisma.InputJsonValue;
      const row = await prisma.trigger.update({ where: { id: input.triggerId }, data });
      return mapTrigger(row as TriggerRecord);
    },

    async deleteTrigger(actor: Actor, triggerId: string): Promise<void> {
      await findOwned(actor, triggerId);
      await prisma.trigger.delete({ where: { id: triggerId } });
    },

    /**
     * Enabled triggers in a space, for one bot and provider, that listen for one event type.
     * A trigger with a null eventType matches any type from its provider. The engine narrows
     * further with the trigger's filter before waking a routine.
     */
    async listEnabledTriggersForEvent(input: {
      spaceId: string;
      botId: string;
      provider: string;
      eventType: string;
    }): Promise<Trigger[]> {
      const rows = await prisma.trigger.findMany({
        where: {
          spaceId: input.spaceId,
          botId: input.botId,
          provider: input.provider,
          enabled: true,
          OR: [{ eventType: input.eventType }, { eventType: null }],
        },
        orderBy: { createdAt: "asc" },
      });
      return (rows as TriggerRecord[]).map(mapTrigger);
    },
  };
}

export type TriggerRepos = ReturnType<typeof createTriggerRepos>;
