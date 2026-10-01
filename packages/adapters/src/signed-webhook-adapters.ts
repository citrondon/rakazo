import type { SignedWebhookAdapter, SignedWebhookRequest } from "./signed-webhook.js";
import { linearWebhookAdapter } from "./signed-webhook-linear.js";
import { pagerDutyWebhookAdapter } from "./signed-webhook-pagerduty.js";
import { sentryWebhookAdapter } from "./signed-webhook-sentry.js";

/**
 * The providers whose own webhook signs the raw body. Each adapter verifies that signature and
 * forwards the normalized event to the existing `/events` route; the hard part (translation) lives
 * in the adapters, and this collection only names them.
 */
export const SIGNED_WEBHOOK_ADAPTERS: readonly SignedWebhookAdapter[] = [
  linearWebhookAdapter,
  sentryWebhookAdapter,
  pagerDutyWebhookAdapter,
];

export function findSignedWebhookAdapter(provider: string): SignedWebhookAdapter | undefined {
  return SIGNED_WEBHOOK_ADAPTERS.find((adapter) => adapter.provider === provider);
}

export function isSignedWebhookProvider(provider: string): boolean {
  return findSignedWebhookAdapter(provider) !== undefined;
}

export type SignedWebhookForwardReason = "invalid-signature" | "unreachable" | "unexpected-status";

export type SignedWebhookForwardResult =
  /** Verified and delivered; `body` is the `/events` route's JSON response. */
  | { ok: true; status: number; delivered: true; body: unknown }
  /** Verified but nothing in the catalog listens for it: a no-op, not an error. */
  | { ok: true; status: number; delivered: false; body: null }
  /** Not forwarded; `status` is 401, 0 for an unreachable endpoint, or the endpoint's status. */
  | { ok: false; status: number; reason: SignedWebhookForwardReason; body?: unknown };

export type SignedWebhookForwardInput = {
  adapter: SignedWebhookAdapter;
  request: SignedWebhookRequest;
  /** The subscription's shared signing secret: verified here and never forwarded. */
  secret: string;
  /** Full URL of the bot's `/events` route; the caller composes it, no env var is read in here. */
  eventsUrl: string;
  /** Bearer token the `/events` route expects. */
  token: string;
  /** Injectable transport so the forward path stays offline-testable. */
  fetch?: typeof globalThis.fetch;
  /** Injectable verification clock for the replay-window check. */
  now?: Date;
};

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Verify a provider-signed delivery, then forward its normalized event to the existing `/events`
 * route. The route is unchanged: this reuses its `{ provider, type, payload }` shape and the bearer
 * token the caller already configured, so no provider signature logic reaches the core.
 */
export async function forwardSignedWebhookEvent(
  input: SignedWebhookForwardInput,
): Promise<SignedWebhookForwardResult> {
  const { adapter, request, secret, now } = input;
  if (!adapter.verify({ ...request, secret, now })) {
    return { ok: false, status: 401, reason: "invalid-signature" };
  }

  const event = adapter.translate(request);
  if (!event) return { ok: true, status: 202, delivered: false, body: null };

  const doFetch = input.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(input.eventsUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.token}`,
        ...(event.id ? { "idempotency-key": event.id } : {}),
      },
      body: JSON.stringify(event),
    });
  } catch {
    return { ok: false, status: 0, reason: "unreachable" };
  }

  const body = await readJson(response);
  if (!response.ok) {
    return { ok: false, status: response.status, reason: "unexpected-status", body };
  }
  return { ok: true, status: response.status, delivered: true, body };
}
