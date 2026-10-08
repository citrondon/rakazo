import type { TriggerEvent } from "@rakazo/contracts";
import { hasValidBearerToken, selectTriggeredRoutines } from "@rakazo/core";
import { createTriggerRepos } from "@rakazo/db";
import type { Hono } from "hono";
import { readBoundedBody } from "./http-body.js";
import {
  deliverWebhookEvent,
  formatUntrustedDeliveryPayload,
  loadWebhookTarget,
  WEBHOOK_MAX_BODY_BYTES,
  type WebhookDeps,
  type WebhookSecretCache,
} from "./webhook-inbound.js";

/** Provider slug shape, the same the trigger store accepts. */
const PROVIDER_PATTERN = /^[a-z0-9._-]{1,50}$/i;

export function eventWebhookPath(botId: string): string {
  return `/api/v1/bots/${botId}/events`;
}

/**
 * A normalized-event inbound path for connectors with no dedicated route (Linear, Sentry,
 * PagerDuty, ...). A shipper POSTs `{ provider, type, payload }`; this narrows the routines whose
 * stored triggers match and delivers them through the same wake path the webhook uses. No
 * provider SDK, signature, or env var is named here: translating a provider's own webhook into
 * this shape belongs to that provider's adapter, not to the core.
 */
export function mountEventWebhookRoute(app: Hono, deps: WebhookDeps) {
  const secretCache: WebhookSecretCache = new Map();
  app.post("/api/v1/bots/:botId/events", async (c) => {
    const unauthorized = () => c.json({ error: "Unauthorized" }, 401);

    const raw = await readBoundedBody(c.req.raw, WEBHOOK_MAX_BODY_BYTES);
    if (raw === null) return c.json({ error: "Payload too large" }, 413);

    const target = await loadWebhookTarget(deps, secretCache, c.req.param("botId"));
    // Same 401 for a missing bot, a missing secret, and a bad bearer so ids stay unenumerable.
    if (!target || !hasValidBearerToken(c.req.header("authorization"), target.expected)) {
      return unauthorized();
    }

    let body: { provider?: unknown; type?: unknown; payload?: unknown; id?: unknown };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return c.json({ error: "Expected a JSON event" }, 400);
    }
    const provider = typeof body.provider === "string" ? body.provider : "";
    const type = typeof body.type === "string" ? body.type.trim() : "";
    const payload =
      body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
        ? (body.payload as Record<string, unknown>)
        : null;
    if (!PROVIDER_PATTERN.test(provider) || !type || !payload) {
      return c.json({ error: "Expected provider, type, and payload" }, 400);
    }

    const triggers = await createTriggerRepos(deps.prisma).listEnabledTriggersForEvent({
      spaceId: target.bot.spaceId,
      botId: target.bot.id,
      provider,
      eventType: type,
    });
    const event: TriggerEvent = { source: "connector", provider, type, payload };

    // Only routines that own a matching trigger are candidates: a routine wired to another
    // provider is never woken by this event, and a stored filter still narrows further.
    const routines =
      triggers.length === 0
        ? []
        : await deps.prisma.routine.findMany({
            where: {
              id: { in: [...new Set(triggers.map((trigger) => trigger.routineId))] },
              spaceId: target.bot.spaceId,
              botId: target.bot.id,
              active: true,
            },
            select: { id: true, name: true, prompt: true },
          });
    const selected = selectTriggeredRoutines(
      routines.map((routine) => ({
        routineId: routine.id,
        name: routine.name,
        prompt: routine.prompt,
      })),
      triggers,
      event,
    );
    if (selected.length === 0) {
      // A broker event nobody listens for is a no-op, not an error.
      return c.json({ ok: true as const, messageId: null, runId: null, seq: 0 });
    }

    const idempotencyKey =
      c.req.header("idempotency-key")?.trim() ||
      c.req.header("x-idempotency-key")?.trim() ||
      (typeof body.id === "string" ? body.id.trim() : "") ||
      undefined;

    return c.json(
      await deliverWebhookEvent(deps, target, {
        prompt: formatUntrustedDeliveryPayload(`[Connector Event: ${provider}]`, {
          provider,
          type,
          payload,
        }),
        routines: selected.map((routine) => ({ name: routine.name, prompt: routine.prompt })),
        source: "webhook",
        idempotencyKey,
        event,
      }),
    );
  });
}
