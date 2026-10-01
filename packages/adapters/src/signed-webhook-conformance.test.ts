import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { findEventDefinition } from "./event-catalog.js";
import type { SignedWebhookAdapter, SignedWebhookRequest } from "./signed-webhook.js";
import {
  findSignedWebhookAdapter,
  forwardSignedWebhookEvent,
  isSignedWebhookProvider,
  SIGNED_WEBHOOK_ADAPTERS,
} from "./signed-webhook-adapters.js";
import { linearWebhookAdapter } from "./signed-webhook-linear.js";
import { pagerDutyWebhookAdapter } from "./signed-webhook-pagerduty.js";
import { sentryWebhookAdapter } from "./signed-webhook-sentry.js";

/**
 * Shared offline conformance suite: every signed-webhook adapter must verify its provider's own
 * signature over the raw body and forward the normalized `{ provider, type, payload }` to the
 * existing `/events` route. Deliveries are minted the way each provider signs them, with
 * `node:crypto` directly rather than any helper from the module under test.
 */

const SECRET = "signed-webhook-test-secret-32chars!";
const NOW = new Date("2026-10-01T12:00:00.000Z");
const EVENTS_URL = "https://rakazo.test/api/v1/bots/bot-1/events";
const TOKEN = "bot-event-token-bearer";

function hmac(secret: string, raw: string): string {
  return createHmac("sha256", secret).update(raw, "utf8").digest("hex");
}

function signedRequest(raw: string, headers: Record<string, string>): SignedWebhookRequest {
  return { raw, headers: new Headers({ "content-type": "application/json", ...headers }) };
}

type Delivery = {
  request: SignedWebhookRequest;
  type: string;
  payload: Record<string, unknown>;
  id: string;
};

function linearDelivery(): Delivery {
  const raw = JSON.stringify({
    action: "create",
    type: "Issue",
    data: {
      id: "issue-1",
      title: "Broken build",
      team: { id: "team-1", key: "ENG", name: "Engineering" },
      labels: [{ id: "label-1", name: "bug" }],
    },
    webhookTimestamp: NOW.getTime(),
    webhookId: "webhook-1",
  });
  return {
    request: signedRequest(raw, {
      "linear-event": "Issue",
      "linear-delivery": "linear-delivery-1",
      "linear-timestamp": String(NOW.getTime()),
      "linear-signature": hmac(SECRET, raw),
    }),
    type: "issue",
    payload: { action: "create", title: "Broken build", team: "Engineering", labels: ["bug"] },
    id: "linear-delivery-1",
  };
}

function linearIgnored(): SignedWebhookRequest {
  const raw = JSON.stringify({ action: "create", type: "Comment", data: { issueId: "issue-1" } });
  return signedRequest(raw, {
    "linear-event": "Comment",
    "linear-timestamp": String(NOW.getTime()),
    "linear-signature": hmac(SECRET, raw),
  });
}

function sentryDelivery(): Delivery {
  const raw = JSON.stringify({
    action: "created",
    installation: { uuid: "install-1" },
    data: {
      issue: {
        id: "1",
        title: "TypeError: boom",
        level: "error",
        permalink: "https://sentry.example/issues/1/",
        project: { id: "p1", slug: "web", name: "web" },
      },
    },
  });
  return {
    request: signedRequest(raw, {
      "sentry-hook-resource": "issue",
      "sentry-hook-timestamp": String(NOW.getTime()),
      "request-id": "sentry-request-1",
      "sentry-hook-signature": hmac(SECRET, raw),
    }),
    type: "issue",
    payload: {
      title: "TypeError: boom",
      project: "web",
      level: "error",
      url: "https://sentry.example/issues/1/",
    },
    id: "sentry-request-1",
  };
}

function sentryIgnored(): SignedWebhookRequest {
  const raw = JSON.stringify({ action: "created", data: { installation: { uuid: "install-1" } } });
  return signedRequest(raw, {
    "sentry-hook-resource": "installation",
    "sentry-hook-signature": hmac(SECRET, raw),
  });
}

function pagerDutyDelivery(): Delivery {
  const raw = JSON.stringify({
    event: {
      id: "evt-1",
      event_type: "incident.triggered",
      data: {
        id: "P1",
        title: "A little bump in the road",
        urgency: "high",
        html_url: "https://acme.pagerduty.example/incidents/P1",
        service: { id: "s1", summary: "Web" },
      },
    },
  });
  return {
    request: signedRequest(raw, { "x-pagerduty-signature": `v1=${hmac(SECRET, raw)}` }),
    type: "incident",
    payload: {
      title: "A little bump in the road",
      service: "Web",
      urgency: "high",
      url: "https://acme.pagerduty.example/incidents/P1",
    },
    id: "evt-1",
  };
}

function pagerDutyIgnored(): SignedWebhookRequest {
  const raw = "[]";
  return signedRequest(raw, { "x-pagerduty-signature": `v1=${hmac(SECRET, raw)}` });
}

type ConformanceCase = {
  adapter: SignedWebhookAdapter;
  signatureHeader: string;
  mint: () => Delivery;
  ignored: () => SignedWebhookRequest;
};

const CASES: ConformanceCase[] = [
  {
    adapter: linearWebhookAdapter,
    signatureHeader: "linear-signature",
    mint: linearDelivery,
    ignored: linearIgnored,
  },
  {
    adapter: sentryWebhookAdapter,
    signatureHeader: "sentry-hook-signature",
    mint: sentryDelivery,
    ignored: sentryIgnored,
  },
  {
    adapter: pagerDutyWebhookAdapter,
    signatureHeader: "x-pagerduty-signature",
    mint: pagerDutyDelivery,
    ignored: pagerDutyIgnored,
  },
];

function recordingFetch() {
  return vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, messageId: "msg-1", runId: "run-1", seq: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

function asFetch(mock: ReturnType<typeof recordingFetch>): typeof globalThis.fetch {
  return mock as unknown as typeof globalThis.fetch;
}

for (const { adapter, signatureHeader, mint, ignored } of CASES) {
  describe(`${adapter.provider} signed webhook conformance (offline)`, () => {
    it("verifies a provider-signed delivery and normalizes it to the catalog event", () => {
      const delivery = mint();

      expect(adapter.verify({ ...delivery.request, secret: SECRET, now: NOW })).toBe(true);
      expect(adapter.translate(delivery.request)).toEqual({
        provider: adapter.provider,
        type: delivery.type,
        payload: delivery.payload,
        id: delivery.id,
      });

      const definition = findEventDefinition(adapter.eventId);
      expect(definition?.provider).toBe(adapter.provider);
      expect(adapter.translate(delivery.request)?.type).toBe(definition?.type);
    });

    it("rejects a body changed after signing", () => {
      const { request } = mint();
      const tampered = { ...request, raw: `${request.raw} ` };
      expect(adapter.verify({ ...tampered, secret: SECRET, now: NOW })).toBe(false);
    });

    it("rejects a delivery signed with another secret", () => {
      const { request } = mint();
      expect(adapter.verify({ ...request, secret: "another-secret", now: NOW })).toBe(false);
    });

    it("rejects a delivery with no signature header", () => {
      const { request } = mint();
      const headers = new Headers(request.headers);
      headers.delete(signatureHeader);
      expect(adapter.verify({ raw: request.raw, headers, secret: SECRET, now: NOW })).toBe(false);
    });

    it("forwards a verified delivery to /events with the bearer token", async () => {
      const delivery = mint();
      const fetchImpl = recordingFetch();

      const result = await forwardSignedWebhookEvent({
        adapter,
        request: delivery.request,
        secret: SECRET,
        eventsUrl: EVENTS_URL,
        token: TOKEN,
        fetch: asFetch(fetchImpl),
        now: NOW,
      });

      expect(result).toMatchObject({ ok: true, delivered: true, status: 200 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe(EVENTS_URL);
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get("idempotency-key")).toBe(delivery.id);
      expect(JSON.parse(String(init?.body))).toEqual({
        provider: adapter.provider,
        type: delivery.type,
        payload: delivery.payload,
        id: delivery.id,
      });
    });

    it("refuses to forward a delivery whose signature does not verify", async () => {
      const { request } = mint();
      const fetchImpl = recordingFetch();

      const result = await forwardSignedWebhookEvent({
        adapter,
        request: { ...request, raw: `${request.raw} ` },
        secret: SECRET,
        eventsUrl: EVENTS_URL,
        token: TOKEN,
        fetch: asFetch(fetchImpl),
        now: NOW,
      });

      expect(result).toEqual({ ok: false, status: 401, reason: "invalid-signature" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("reports an unreachable endpoint instead of throwing", async () => {
      const delivery = mint();
      const fetchImpl = vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      });

      const result = await forwardSignedWebhookEvent({
        adapter,
        request: delivery.request,
        secret: SECRET,
        eventsUrl: EVENTS_URL,
        token: TOKEN,
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
        now: NOW,
      });

      expect(result).toEqual({ ok: false, status: 0, reason: "unreachable" });
    });

    it("treats a delivery the catalog does not represent as a no-op", async () => {
      const fetchImpl = recordingFetch();

      const result = await forwardSignedWebhookEvent({
        adapter,
        request: ignored(),
        secret: SECRET,
        eventsUrl: EVENTS_URL,
        token: TOKEN,
        fetch: asFetch(fetchImpl),
        now: NOW,
      });

      expect(result).toEqual({ ok: true, status: 202, delivered: false, body: null });
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
}

describe("signed webhook adapters", () => {
  it("registers exactly the reach providers, each backed by EVENT_CATALOG", () => {
    expect(SIGNED_WEBHOOK_ADAPTERS.map((adapter) => adapter.provider)).toEqual([
      "linear",
      "sentry",
      "pagerduty",
    ]);
    for (const adapter of SIGNED_WEBHOOK_ADAPTERS) {
      const definition = findEventDefinition(adapter.eventId);
      expect(definition?.provider).toBe(adapter.provider);
      expect(definition?.source).toBe("connector");
    }
    expect(findSignedWebhookAdapter("pagerduty")?.eventId).toBe("pagerduty:incident");
    expect(findSignedWebhookAdapter("unknown")).toBeUndefined();
    expect(isSignedWebhookProvider("sentry")).toBe(true);
    expect(isSignedWebhookProvider("unknown")).toBe(false);
  });
});
