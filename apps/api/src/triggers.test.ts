import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import {
  createTrigger,
  deleteTrigger,
  listEvents,
  listTriggers,
  updateTrigger,
} from "./triggers.js";

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
    source: "webhook",
    provider: "webhook",
    eventType: "generic",
    filter: { predicates: [{ field: "payload.kind", operator: "exists" }] },
    mappings: [],
    enabled: true,
    createdAt: new Date("2026-10-10T09:00:00.000Z"),
    updatedAt: new Date("2026-10-10T09:00:00.000Z"),
    ...overrides,
  };
}

function depsFor(routineUpdate = vi.fn(async () => ({ id: "routine-1" }))) {
  const create = vi.fn(async (_args: { data: Record<string, unknown> }) =>
    triggerRow({ routineId: "routine-1" }),
  );
  const routineFindFirst = vi.fn(async (_args: unknown) => ({ id: "routine-1", botId: "bot-1" }));
  const prisma = {
    trigger: { create },
    routine: { findFirst: routineFindFirst, update: routineUpdate },
  };
  return { deps: { prisma: prisma as unknown as PrismaClient }, routineUpdate };
}

describe("createTrigger handler", () => {
  it("enables the routine's webhook flag for a webhook trigger", async () => {
    const { deps, routineUpdate } = depsFor();

    const created = await createTrigger(deps, actor, {
      routineId: "routine-1",
      source: "webhook",
      provider: "webhook",
      eventType: "generic",
      filter: { predicates: [{ field: "payload.kind", operator: "exists", caseSensitive: false }] },
      mappings: [],
      enabled: true,
    });

    expect(routineUpdate.mock.calls[0]![0]).toMatchObject({
      where: { id: "routine-1" },
      data: { webhookEnabled: true },
    });
    expect(created.id).toBe("trg-1");
  });

  it("enables the GitHub flag for a github trigger instead", async () => {
    const routineUpdate = vi.fn(async () => ({ id: "routine-1" }));
    const { deps } = depsFor(routineUpdate);

    await createTrigger(deps, actor, {
      routineId: "routine-1",
      source: "connector",
      provider: "github",
      eventType: "issues",
      filter: {
        predicates: [
          { field: "payload.action", operator: "equals", value: "opened", caseSensitive: false },
        ],
      },
      mappings: [],
      enabled: true,
    });

    expect(routineUpdate.mock.calls[0]![0]).toMatchObject({
      where: { id: "routine-1" },
      data: { githubEnabled: true },
    });
  });

  it("leaves a connector trigger's routine flags untouched", async () => {
    const routineUpdate = vi.fn(async () => ({ id: "routine-1" }));
    const { deps } = depsFor(routineUpdate);

    await createTrigger(deps, actor, {
      routineId: "routine-1",
      source: "connector",
      provider: "linear",
      eventType: "issue",
      filter: {
        predicates: [{ field: "payload.action", operator: "exists", caseSensitive: false }],
      },
      mappings: [],
      enabled: true,
    });

    expect(routineUpdate).not.toHaveBeenCalled();
  });
});

describe("trigger passthrough handlers", () => {
  it("delegates list, update, and delete to the repo", async () => {
    const listRepos = vi.fn(async () => [triggerRow()]);
    const listDeps = {
      prisma: { trigger: { findMany: listRepos } } as unknown as PrismaClient,
    };
    await listTriggers(listDeps, actor, { routineId: "routine-1" });
    expect(listRepos.mock.calls[0]![0].where).toMatchObject({ routineId: "routine-1" });

    const update = vi.fn(async () => triggerRow({ enabled: false }));
    const updateDeps = {
      prisma: {
        trigger: { findFirst: vi.fn(async () => ({ id: "trg-1" })), update },
      } as unknown as PrismaClient,
    };
    const updated = await updateTrigger(updateDeps, actor, { triggerId: "trg-1", enabled: false });
    expect(updated.enabled).toBe(false);

    const remove = vi.fn(async () => triggerRow());
    const deleteDeps = {
      prisma: {
        trigger: { findFirst: vi.fn(async () => ({ id: "trg-1" })), delete: remove },
      } as unknown as PrismaClient,
    };
    await expect(deleteTrigger(deleteDeps, actor, { triggerId: "trg-1" })).resolves.toEqual({
      ok: true,
    });
  });
});

describe("listEvents", () => {
  it("returns the provider-neutral catalog a trigger picker renders", () => {
    const events = listEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({ id: expect.any(String), provider: expect.any(String) });
    expect(events.some((entry) => entry.id === "github:issues")).toBe(true);
  });
});
