import { createHmac, timingSafeEqual } from "node:crypto";
import { asRecord } from "./connector-http.js";
import { findEventDefinition } from "./event-catalog.js";

/**
 * Provider-neutral seam for inbound webhooks that sign their own raw request body.
 *
 * Some providers (Linear, Sentry, PagerDuty) do not ship a connector that watches BobBot like the
 * chat adapters do: they POST their own payload to a URL we hand them and sign the raw bytes with
 * a shared secret. An adapter verifies that signature and translates the provider payload into the
 * normalized `{ provider, type, payload }` the existing `/events` route already accepts, so no
 * provider-shaped data and no signature logic reaches the core.
 *
 * Nothing here reads an environment variable or names a vendor SDK. The caller supplies the shared
 * secret and the destination, exactly like every other connection; the secret is verified in here
 * and never forwarded.
 */

/** A delivery as the provider sent it: the exact raw body plus the request headers. */
export type SignedWebhookRequest = {
  raw: string;
  headers: Headers;
};

/** The normalized event the `/events` route accepts, produced from a verified delivery. */
export type SignedWebhookEvent = {
  provider: string;
  type: string;
  payload: Record<string, unknown>;
  /** Provider delivery id, when present, so a redelivery can be deduped. */
  id?: string;
};

/** Verification input: the delivery plus the caller-supplied secret and an injectable clock. */
export type SignedWebhookVerification = SignedWebhookRequest & {
  /** The subscription's shared signing secret. Supplied by the caller, never from env in here. */
  secret: string;
  /** Verification clock; injection keeps a replay-window check deterministic in tests. */
  now?: Date;
};

export interface SignedWebhookAdapter {
  /** Provider slug, the same the trigger store and EVENT_CATALOG use. */
  readonly provider: string;
  /** The EVENT_CATALOG entry this adapter emits, e.g. `linear:issue`. */
  readonly eventId: string;
  /** Verify the provider signature over the exact raw body. */
  verify(input: SignedWebhookVerification): boolean;
  /** Normalize a verified delivery, or null when the catalog does not represent it. */
  translate(request: SignedWebhookRequest): SignedWebhookEvent | null;
}

/** Hex HMAC-SHA256 of the raw body: the digest shape all three providers sign with. */
export function hmacSha256Hex(secret: string, raw: string): string {
  return createHmac("sha256", secret).update(raw, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests; a length mismatch is a non-match, not a throw. */
export function timingSafeEqualHex(expected: string, provided: string): boolean {
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(provided, "hex");
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

/** Parse a `v1=<hex>, v1=<hex>` rotation list into the hex values for one signature version. */
export function parseVersionedSignatures(
  header: string | null | undefined,
  version = "v1",
): string[] {
  if (!header) return [];
  const prefix = `${version}=`;
  const values: string[] = [];
  for (const part of header.split(",")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    const hex = trimmed.slice(prefix.length).trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) values.push(hex);
  }
  return values;
}

/** Header value, trimmed, or undefined: providers send each header once. */
export function headerValue(request: SignedWebhookRequest, name: string): string | undefined {
  const value = request.headers.get(name)?.trim();
  return value ? value : undefined;
}

/** Parse a JSON object body, or undefined when the body is not a JSON object. */
export function parseJsonRecord(raw: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

/** A trimmed, non-empty string at `key`, or undefined. */
export function stringField(
  source: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = source?.[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Drop undefined/null/empty values so a normalized payload carries only real fields. */
export function compactRecord(source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    result[key] = value;
  }
  return result;
}

/**
 * The EVENT_CATALOG `type` for a catalog id. Resolved from the catalog so an adapter cannot emit a
 * type the catalog does not offer; a missing entry fails at load time rather than in production.
 */
export function requireEventType(eventId: string): string {
  const entry = findEventDefinition(eventId);
  if (!entry) throw new Error(`EVENT_CATALOG has no entry ${eventId}`);
  return entry.type;
}
