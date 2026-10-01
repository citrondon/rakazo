import { asRecord } from "./connector-http.js";
import {
  compactRecord,
  hmacSha256Hex,
  parseJsonRecord,
  parseVersionedSignatures,
  requireEventType,
  type SignedWebhookAdapter,
  type SignedWebhookEvent,
  type SignedWebhookRequest,
  type SignedWebhookVerification,
  stringField,
  timingSafeEqualHex,
} from "./signed-webhook.js";

const PAGERDUTY_EVENT_ID = "pagerduty:incident";
const PAGERDUTY_EVENT_TYPE = requireEventType(PAGERDUTY_EVENT_ID);

/**
 * PagerDuty v3 webhook: `X-PagerDuty-Signature` carries one or more `v1=<hex>` HMAC-SHA256
 * signatures of the raw body (comma-separated during zero-downtime secret rotation). Any matching
 * v1 signature authenticates the delivery; the payload wraps the incident under `event.data`.
 */
export const pagerDutyWebhookAdapter: SignedWebhookAdapter = {
  provider: "pagerduty",
  eventId: PAGERDUTY_EVENT_ID,
  verify(input: SignedWebhookVerification): boolean {
    const signatures = parseVersionedSignatures(input.headers.get("x-pagerduty-signature"));
    if (signatures.length === 0) return false;
    const expected = hmacSha256Hex(input.secret, input.raw);
    return signatures.some((candidate) => timingSafeEqualHex(expected, candidate));
  },
  translate(request: SignedWebhookRequest): SignedWebhookEvent | null {
    const payload = parseJsonRecord(request.raw);
    if (!payload) return null;
    const event = asRecord(payload.event) ?? payload;
    const data = asRecord(event.data) ?? {};
    const service = asRecord(data.service);

    return {
      provider: "pagerduty",
      type: PAGERDUTY_EVENT_TYPE,
      payload: compactRecord({
        title: stringField(data, "title"),
        service: service
          ? (stringField(service, "summary") ?? stringField(service, "name"))
          : undefined,
        urgency: stringField(data, "urgency"),
        url: stringField(data, "html_url") ?? stringField(data, "url"),
      }),
      id: stringField(event, "id"),
    };
  },
};
