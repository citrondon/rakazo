import type { Actor } from "@bobbot/contracts";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";
import { createTriggerRepos } from "./triggers.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "ws-1",
  email: "test@example.com",
  isDeploymentOwner: false,
};

function triggerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "trg-1",
    routineId: "routine-1",
    botId: "bot-1",
    source: "connector",
    provider: "github",
    eventType: "issues",
    filter: { predicates: [{ field: "payload.action", operator: "equals", value: "opened" }] },
    mappings: [{ from: "payload.repository.full_name", to: "repo" }],
    enabled: true,
    createdAt: new Date("2026-10-10T09:00:00.000Z"),
    updatedAt: new Date("2026-10-10T09:00:00.000Z"),
    ...overrides,
  };
}

function reposFor(prisma: Record<string, unknown>) {
  return createTriggerRepos(prisma as unknown as PrismaClient);
}

describe("createTriggerRepos.createTrigger", () => {
  it("derives botId from the owned routine and stores the narrow rule", async () => {
    const create = vi.fn(async (_args: { data: Record<string, unknown> }) => triggerRow());
    const routineFindFirst = vi.fn(async (_args: unknown) => ({ id: "routine-1", botId: "bot-1" }));
    const repos = reposFor({ trigger: { create }, routine: { findFirst: routineFindFirst } });

    const created = await repos.createTrigger(actor, {
      routineId: "routine-1",
      source: "connector",
      provider: "github",
      eventType: "issues",
      filter: {
        predicates: [
          { field: "payload.action", operator: "equals", value: "opened", caseSensitive: false },
        ],
      },
      mappings: [{ from: "payload.repository.full_name", to: "repo" }],
      enabled: true,
    });

    expect(routineFindFirst).toHaveBeenCalledWith({
      where: { id: "routine-1", spaceId: "ws-1", userId: "user-1" },
      select: { id: true, botId: true },
    });
    expect(create.mock.calls[0]![0].data).toMatchObject({
      spaceId: "ws-1",
      routineId: "routine-1",
      botId: "bot-1",
      userId: "user-1",
      provider: "github",
      eventType: "issues",
    });
    expect(created).toMatchObject({
      id: "trg-1",
      botId: "bot-1",
      eventType: "issues",
      enabled: true,
    });
    expect(created.createdAt).toBe("2026-10-10T09:00:00.000Z");
  });

  it("rejects a routine the actor does not own", async () => {
    const repos = reposFor({
      trigger: { create: vi.fn() },
      routine: { findFirst: vi.fn(async () => null) },
    });
    await expect(
      repos.createTrigger(actor, {
        routineId: "routine-x",
        source: "connector",
        provider: "github",
        eventType: null,
        filter: {
          predicates: [{ field: "payload.action", operator: "exists", caseSensitive: false }],
        },
        mappings: [],
        enabled: true,
      }),
    ).rejects.toBeInstanceOf(IsolationError);
  });
});

describe("createTriggerRepos.listTriggers", () => {
  it("scopes to the actor's space and routine, then maps rows", async () => {
    const findMany = vi.fn(async (_args: { where: Record<string, unknown> }) => [triggerRow()]);
    const repos = reposFor({ trigger: { findMany } });

    const triggers = await repos.listTriggers(actor, "routine-1");

    expect(findMany.mock.calls[0]![0].where).toEqual({
      spaceId: "ws-1",
      userId: "user-1",
      routineId: "routine-1",
    });
    expect(triggers).toHaveLength(1);
    expect(triggers[0]!.filter.predicates).toHaveLength(1);
    expect(triggers[0]!.mappings).toEqual([{ from: "payload.repository.full_name", to: "repo" }]);
  });

  it("defaults a missing filter to an empty predicate list", async () => {
    const findMany = vi.fn(async (_args: { where: Record<string, unknown> }) => [
      triggerRow({ filter: null, mappings: null }),
    ]);
    const repos = reposFor({ trigger: { findMany } });
    const [trigger] = await repos.listTriggers(actor, "routine-1");
    expect(trigger!.filter).toEqual({ predicates: [] });
    expect(trigger!.mappings).toEqual([]);
  });
  describe("createTriggerRepos.updateTrigger", () => {
    it("applies only the provided fields", async () => {
      const findFirst = vi.fn(async (_args: { where: Record<string, unknown> }) => ({
        id: "trg-1",
      }));
      const update = vi.fn(async (_args: { where: unknown; data: Record<string, unknown> }) =>
        triggerRow({ enabled: false }),
      );
      const repos = reposFor({ trigger: { findFirst, update } });

      const updated = await repos.updateTrigger(actor, { triggerId: "trg-1", enabled: false });

      expect(findFirst.mock.calls[0]![0].where).toEqual({
        id: "trg-1",
        spaceId: "ws-1",
        userId: "user-1",
      });
      expect(update.mock.calls[0]![0].data).toEqual({ enabled: false });
      expect(updated.enabled).toBe(false);
    });

    it("rejects a trigger outside the actor's scope", async () => {
      const repos = reposFor({ trigger: { findFirst: vi.fn(async () => null), update: vi.fn() } });
      await expect(
        repos.updateTrigger(actor, { triggerId: "trg-x", enabled: true }),
      ).rejects.toBeInstanceOf(IsolationError);
    });
  });

  describe("createTriggerRepos.deleteTrigger", () => {
    it("deletes an owned trigger", async () => {
      const remove = vi.fn(async () => triggerRow());
      const repos = reposFor({
        trigger: { findFirst: vi.fn(async () => ({ id: "trg-1" })), delete: remove },
      });
      await repos.deleteTrigger(actor, "trg-1");
      expect(remove).toHaveBeenCalledWith({ where: { id: "trg-1" } });
    });

    it("rejects a trigger outside the actor's scope", async () => {
      const repos = reposFor({ trigger: { findFirst: vi.fn(async () => null), delete: vi.fn() } });
      await expect(repos.deleteTrigger(actor, "trg-x")).rejects.toBeInstanceOf(IsolationError);
    });
  });

  describe("createTriggerRepos.listEnabledTriggersForEvent", () => {
    it("matches the provider and either the event type or a wildcard trigger", async () => {
      const findMany = vi.fn(async (_args: { where: Record<string, unknown> }) => [triggerRow()]);
      const repos = reposFor({ trigger: { findMany } });

      await repos.listEnabledTriggersForEvent({
        spaceId: "ws-1",
        botId: "bot-1",
        provider: "github",
        eventType: "issues",
      });

      expect(findMany.mock.calls[0]![0].where).toEqual({
        spaceId: "ws-1",
        botId: "bot-1",
        provider: "github",
        enabled: true,
        OR: [{ eventType: "issues" }, { eventType: null }],
      });
    });
  });
});
