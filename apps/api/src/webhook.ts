import { hasValidBearerToken } from "@rakazo/core";
import { createTriggerRepos } from "@rakazo/db";
import type { Hono } from "hono";
import { mountGithubWebhookRoute } from "./github-webhook.js";
import { readBoundedBody } from "./http-body.js";
import {
  deliverWebhookEvent,
  formatWebhookPrompt,
  inboundEventName,
  loadWebhookTarget,
  parseWebhookPayload,
  WEBHOOK_MAX_BODY_BYTES,
  type WebhookDeps,
} from "./webhook-inbound.js";

export {
  formatGithubEventPrompt,
  githubEventName,
  githubWebhookPath,
  hasValidGithubSignature,
} from "./github-webhook.js";
export {
  formatUntrustedDeliveryPayload,
  formatWebhookPrompt,
  WEBHOOK_MAX_BODY_BYTES,
  WEBHOOK_SECRET_KIND,
  type WebhookDeps,
  type WebhookEvents,
  type WebhookTarget,
} from "./webhook-inbound.js";

export function webhookPath(botId: string): string {
  return `/api/v1/bots/${botId}/webhook`;
}

export function mountWebhookHttpRoutes(app: Hono, deps: WebhookDeps) {
  app.post("/api/v1/bots/:botId/webhook", async (c) => {
    const unauthorized = () => c.json({ error: "Unauthorized" }, 401);

    // Reject oversized bodies before target lookup so size limits do not reveal active bots.
    const raw = await readBoundedBody(c.req.raw, WEBHOOK_MAX_BODY_BYTES);
    if (raw === null) {
      return c.json({ error: "Payload too large" }, 413);
    }

    const target = await loadWebhookTarget(deps, c.req.param("botId"));

    // Same 401 for missing bot, missing secret, and bad bearer so bot ids are not enumerable.
    if (!target || !hasValidBearerToken(c.req.header("authorization"), target.expected)) {
      return unauthorized();
    }

    const payload = parseWebhookPayload(raw, c.req.header("content-type"));
    const eventPrompt = formatWebhookPrompt(payload);

    const webhookRoutines = await deps.prisma.routine.findMany({
      where: {
        botId: target.bot.id,
        spaceId: target.bot.spaceId,
        active: true,
        webhookEnabled: true,
      },
      select: { id: true, name: true, prompt: true },
      orderBy: { updatedAt: "desc" },
      take: 5,
    });

    // A stored trigger narrows which of those routines may run and folds in mapped fields.
    const eventType =
      typeof payload.event === "string" ? inboundEventName(payload.event) : "generic";
    const triggers = await createTriggerRepos(deps.prisma).listEnabledTriggersForEvent({
      spaceId: target.bot.spaceId,
      botId: target.bot.id,
      provider: "webhook",
      eventType,
    });

    const idempotencyKey =
      c.req.header("idempotency-key")?.trim() ||
      c.req.header("x-idempotency-key")?.trim() ||
      (typeof payload.id === "string" ? payload.id.trim() : "") ||
      (typeof payload.event_id === "string" ? payload.event_id.trim() : "") ||
      undefined;

    return c.json(
      await deliverWebhookEvent(deps, target, {
        prompt: eventPrompt,
        routines: webhookRoutines,
        source: "webhook",
        idempotencyKey,
        triggers,
        event: { source: "webhook", provider: "webhook", type: eventType, payload },
      }),
    );
  });

  mountGithubWebhookRoute(app, deps);
}
