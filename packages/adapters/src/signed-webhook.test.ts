import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hmacSha256Hex, parseVersionedSignatures, timingSafeEqualHex } from "./signed-webhook.js";
import { linearWebhookAdapter } from "./signed-webhook-linear.js";
import { pagerDutyWebhookAdapter } from "./signed-webhook-pagerduty.js";

const SECRET = "signed-webhook-test-secret-32chars!";

describe("signed webhook helpers", () => {
  it("computes the same hex HMAC-SHA256 node crypto does", () => {
    const expected = createHmac("sha256", SECRET).update("raw body", "utf8").digest("hex");
    expect(hmacSha256Hex(SECRET, "raw body")).toBe(expected);
  });

  it("compares hex digests without throwing on length or content drift", () => {
    expect(timingSafeEqualHex("00".repeat(32), "00".repeat(32))).toBe(true);
    expect(timingSafeEqualHex("00".repeat(32), "00".repeat(16))).toBe(false);
    expect(timingSafeEqualHex("00".repeat(32), "01".repeat(32))).toBe(false);
    expect(timingSafeEqualHex("", "")).toBe(false);
    expect(timingSafeEqualHex("zz", "zz")).toBe(false);
  });

  it("reads only the requested signature version from a rotation list", () => {
    const first = "a".repeat(64);
    const second = "c".repeat(64);
    expect(parseVersionedSignatures(`v1=${first}, v2=${"b".repeat(64)}`)).toEqual([first]);
    expect(parseVersionedSignatures(`v1=${first}, v1=${second}`)).toEqual([first, second]);
    expect(parseVersionedSignatures(undefined)).toEqual([]);
    expect(parseVersionedSignatures("garbage")).toEqual([]);
    expect(parseVersionedSignatures("v1=not-a-digest")).toEqual([]);
  });
});

describe("linear webhook replay window", () => {
  const raw = JSON.stringify({ action: "create", type: "Issue", data: { title: "x" } });
  const signature = hmacSha256Hex(SECRET, raw);
  const now = new Date("2026-10-01T12:00:00.000Z");

  function verify(timestamp?: number): boolean {
    const headers = new Headers({ "linear-signature": signature });
    if (timestamp !== undefined) headers.set("linear-timestamp", String(timestamp));
    return linearWebhookAdapter.verify({ raw, headers, secret: SECRET, now });
  }

  it("accepts within the documented 60s window and rejects a stale delivery", () => {
    expect(verify(now.getTime() - 30_000)).toBe(true);
    expect(verify(now.getTime() + 30_000)).toBe(true);
    expect(verify(now.getTime() - 5 * 60_000)).toBe(false);
    expect(verify(now.getTime() + 5 * 60_000)).toBe(false);
  });

  it("accepts an un-stamped delivery on the signature alone", () => {
    expect(verify()).toBe(true);
  });
});

describe("pagerduty signature rotation", () => {
  const raw = JSON.stringify({ event: { id: "evt-1", data: {} } });
  const good = hmacSha256Hex(SECRET, raw);

  it("accepts when any v1 signature in the rotation list matches", () => {
    const rotating = new Headers({
      "x-pagerduty-signature": `v1=${"a".repeat(64)}, v1=${good}`,
    });
    expect(pagerDutyWebhookAdapter.verify({ raw, headers: rotating, secret: SECRET })).toBe(true);

    const stale = new Headers({ "x-pagerduty-signature": `v1=${"a".repeat(64)}` });
    expect(pagerDutyWebhookAdapter.verify({ raw, headers: stale, secret: SECRET })).toBe(false);

    const wrongVersion = new Headers({ "x-pagerduty-signature": `v2=${good}` });
    expect(pagerDutyWebhookAdapter.verify({ raw, headers: wrongVersion, secret: SECRET })).toBe(
      false,
    );
  });
});
