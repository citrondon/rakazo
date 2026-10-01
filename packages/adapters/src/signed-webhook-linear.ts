import { asRecord } from "./connector-http.js";
import {
  compactRecord,
  headerValue,
  hmacSha256Hex,
  parseJsonRecord,
  requireEventType,
  type SignedWebhookAdapter,
  type SignedWebhookEvent,
  type SignedWebhookRequest,
  type SignedWebhookVerification,
  stringField,
  timingSafeEqualHex,
} from "./signed-webhook.js";

const LINEAR_EVENT_ID = "linear:issue";
const LINEAR_EVENT_TYPE = requireEventType(LINEAR_EVENT_ID);

/** Linear documents a 60-second window on the delivery timestamp. */
const LINEAR_REPLAY_WINDOW_MS = 60 * 1000;

/** The millisecond epoch Linear stamps a delivery with, from the header or the body. */
function deliveryTimestamp(request: SignedWebhookRequest): number | undefined {
  const header = headerValue(request, "linear-timestamp");
  if (header) {
    const parsed = Number.parseInt(header, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const value = parseJsonRecord(request.raw)?.webhookTimestamp;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Linear data-change webhook: `Linear-Signature` is the hex HMAC-SHA256 of the raw body, and
 * `Linear-Timestamp` (mirrored as `webhookTimestamp` in the body) bounds replay. Only the Issue
 * resource maps to the catalog; other Linear resources are not delivered here.
 */
export const linearWebhookAdapter: SignedWebhookAdapter = {
  provider: "linear",
  eventId: LINEAR_EVENT_ID,
  verify(input: SignedWebhookVerification): boolean {
    const signature = headerValue(input, "linear-signature");
    if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
    if (!timingSafeEqualHex(hmacSha256Hex(input.secret, input.raw), signature)) return false;
    const timestamp = deliveryTimestamp(input);
    // Linear always stamps a delivery; when present, reject a replay outside the documented window.
    if (timestamp !== undefined) {
      const now = (input.now ?? new Date()).getTime();
      if (Math.abs(now - timestamp) > LINEAR_REPLAY_WINDOW_MS) return false;
    }
    return true;
  },
  translate(request: SignedWebhookRequest): SignedWebhookEvent | null {
    const payload = parseJsonRecord(request.raw);
    if (!payload) return null;
    const resource = headerValue(request, "linear-event") ?? stringField(payload, "type");
    if (resource && resource.toLowerCase() !== "issue") return null;

    const data = asRecord(payload.data) ?? {};
    const team = asRecord(data.team);
    const labels = Array.isArray(data.labels)
      ? data.labels
          .map((label) => asRecord(label)?.name ?? label)
          .filter((name): name is string => typeof name === "string" && name.length > 0)
      : [];

    return {
      provider: "linear",
      type: LINEAR_EVENT_TYPE,
      payload: compactRecord({
        action: stringField(payload, "action"),
        title: stringField(data, "title"),
        team: team ? (stringField(team, "name") ?? stringField(team, "key")) : undefined,
        labels,
      }),
      id: headerValue(request, "linear-delivery") ?? stringField(payload, "webhookId"),
    };
  },
};
