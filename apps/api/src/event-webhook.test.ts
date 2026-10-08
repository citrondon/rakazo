import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { mountEventWebhookRoute } from "./event-webhook.js";
import type { WebhookDeps } from "./webhook-inbound.js";

const SECRET = "event-test-secret-value-32chars!!!!";

function triggerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "trg-1",
    routineId: "routine-1",
    botId: "bot-1",
    source: "connector",
    provider: "linear",
    eventType: "issue",
    filter: {
      predicates: [
        { field: "payload.action", operator: "equals", value: "created", caseSensitive: false },
      ],
    },
    mappings: [{ from: "payload.title", to: "title" }],
    enabled: true,
    createdAt: new Date("2026-10-10T09:00:00.000Z"),
    updatedAt: new Date("2026-10-10T09:00:00.000Z"),
    ...overrides,
  };
}

function createDeps(overrides: { triggers?: unknown[]; routines?: unknown[] } = {}): {
  deps: WebhookDeps;
  sendUserMessage: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
  findRoutines: ReturnType<typeof vi.fn>;
} {
  const sendUserMessage = vi.fn(async () => ({ messageId: "msg-1", runId: "run-1", seq: 3 }));
  const enqueue = vi.fn(async () => undefined);
  const findRoutines = vi.fn(
    async () =>
      overrides.routines ?? [{ id: "routine-1", name: "Triage", prompt: "Triage the issue." }],
  );
  const deps = {
    prisma: {
      bot: {
        findUnique: vi.fn(async () => ({
          id: "bot-1",
          spaceId: "ws-1",
          userId: "user-1",
          webhookSecretId: "secret-1",
          thread: { id: "thread-1" },
        })),
      },
      secret: {
        findUnique: vi.fn(async () => ({
          id: "secret-1",
          ciphertext: "cipher",
          kind: "webhook",
          userId: "user-1",
          spaceId: "ws-1",
        })),
      },
      trigger: { findMany: vi.fn(async () => overrides.triggers ?? [triggerRow()]) },
      routine: { findMany: findRoutines },
    } as unknown as WebhookDeps["prisma"],
    secrets: { load: async () => SECRET } as unknown as WebhookDeps["secrets"],
    events: { sendUserMessage },
    jobs: { enqueue } as unknown as WebhookDeps["jobs"],
  } as WebhookDeps;
  return { deps, sendUserMessage, enqueue, findRoutines };
}

function post(
  deps: WebhookDeps,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const app = new Hono();
  mountEventWebhookRoute(app, deps);
  return app.request("/api/v1/bots/bot-1/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SECRET}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("mountEventWebhookRoute", () => {
  it("delivers a matching connector event and folds mapped fields into the routine", async () => {
    const { deps, sendUserMessage, enqueue } = createDeps();

    const response = await post(deps, {
      provider: "linear",
      type: "issue",
      payload: { action: "created", title: "Broken build" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, runId: "run-1" });
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    const message = sendUserMessage.mock.calls[0]![0] as { prompt: string; trigger: string };
    expect(message.trigger).toBe("webhook");
    expect(message.prompt).toContain("Triage");
    expect(message.prompt).toContain("title: Broken build");
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("treats an event no trigger matches as a no-op", async () => {
    const { deps, sendUserMessage, enqueue } = createDeps();

    const response = await post(deps, {
      provider: "linear",
      type: "issue",
      payload: { action: "closed", title: "Broken build" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, runId: null });
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does not read routines when no trigger listens", async () => {
    const { deps, sendUserMessage, findRoutines } = createDeps({ triggers: [] });

    const response = await post(deps, {
      provider: "sentry",
      type: "issue",
      payload: { title: "Boom" },
    });

    expect(response.status).toBe(200);
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(findRoutines).not.toHaveBeenCalled();
  });

  it("rejects an event that is not a normalized trigger event", async () => {
    const { deps } = createDeps();
    const response = await post(deps, { provider: "linear", type: "issue" });
    expect(response.status).toBe(400);
  });

  it("rejects a caller without the bot's secret", async () => {
    const { deps, sendUserMessage } = createDeps();
    const response = await post(
      deps,
      { provider: "linear", type: "issue", payload: { action: "created" } },
      { authorization: "Bearer wrong-secret" },
    );
    expect(response.status).toBe(401);
    expect(sendUserMessage).not.toHaveBeenCalled();
  });
});
