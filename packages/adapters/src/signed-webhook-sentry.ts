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

const SENTRY_EVENT_ID = "sentry:issue";
const SENTRY_EVENT_TYPE = requireEventType(SENTRY_EVENT_ID);

/**
 * Sentry integration-platform webhook: `Sentry-Hook-Signature` is the hex HMAC-SHA256 of the raw
 * body keyed by the client secret. `Sentry-Hook-Resource` names the resource; only the issue
 * resource maps to the catalog, so installation/error/comment deliveries are ignored.
 */
export const sentryWebhookAdapter: SignedWebhookAdapter = {
  provider: "sentry",
  eventId: SENTRY_EVENT_ID,
  verify(input: SignedWebhookVerification): boolean {
    const signature = headerValue(input, "sentry-hook-signature");
    if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
    return timingSafeEqualHex(hmacSha256Hex(input.secret, input.raw), signature);
  },
  translate(request: SignedWebhookRequest): SignedWebhookEvent | null {
    const resource = headerValue(request, "sentry-hook-resource");
    if (resource && resource.toLowerCase() !== "issue") return null;

    const payload = parseJsonRecord(request.raw);
    if (!payload) return null;
    const issue = asRecord(asRecord(payload.data)?.issue) ?? {};
    const project = asRecord(issue.project);

    return {
      provider: "sentry",
      type: SENTRY_EVENT_TYPE,
      payload: compactRecord({
        title: stringField(issue, "title"),
        project: project
          ? (stringField(project, "slug") ?? stringField(project, "name"))
          : undefined,
        level: stringField(issue, "level"),
        url: stringField(issue, "permalink") ?? stringField(issue, "url"),
      }),
      id: headerValue(request, "request-id"),
    };
  },
};
