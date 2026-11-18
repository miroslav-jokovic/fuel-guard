import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FLEETPAL_WEBHOOK_EVENTS } from "@silvicom/shared";
import { testEnv } from "../../testing/testEnv.js";
import { seal, secretAad } from "../../lib/secretBox.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { receiveDelivery, signedAtMs, subscribeAll, unsubscribeAll, verifyFleetpalSignature } from "./webhooks.js";
import { FleetpalError } from "./errors.js";

/**
 * F15's three done-whens, each a test here: a forged signature is rejected, a replayed
 * `X-Fleetpal-Delivery` is a no-op, and an out-of-order retry cannot overwrite newer state — because a
 * verified delivery writes nothing but its own claim (D-FP10). Plus the subscription lifecycle FleetPal
 * forces on us: a secret returned once, no DELETE.
 */
const ORG = "11111111-1111-4111-8111-111111111111";
// Readable test values — a hex-looking constant reads as a leaked key to the secret scanner.
const SECRET = "the-shop-webhook-secret-for-tests";
const env = testEnv({
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  PUBLIC_API_URL: "https://api.example.test",
});
const NOW = Date.parse("2026-11-16T20:00:00Z");
const sealed = seal(env, SECRET, secretAad(ORG, "fleetpal.webhook_secret"));

const body = Buffer.from(JSON.stringify({ event: "work_order.closed", data: { id: "wo-1", total: 999 } }));
const sign = (ts: string, raw: Buffer, secret = SECRET) =>
  `sha256=${crypto.createHmac("sha256", secret).update(`${ts}.`).update(raw).digest("hex")}`;
const headers = (over: Record<string, string> = {}) => {
  const timestamp = String(NOW / 1000);
  return {
    event: "work_order.closed",
    delivery: "dlv-1",
    eventTimestamp: "2026-11-16T19:59:00Z",
    timestamp,
    signature: sign(timestamp, body),
    ...over,
  };
};

function recorder(opts: { active?: boolean; claimConflict?: boolean } = {}) {
  return createSupabaseRecorder({
    tables: {
      // Answers on the filter actually sent: a paused row is returned unless the query asked for
      // active ones only, so a receiver that forgot `is_active` would verify against a paused secret.
      fleetpal_webhook_subscriptions: (q) => {
        const row = { id: "s1", subscription_id: "sub-1", event_key: "work_order.closed", secret_sealed: sealed, is_active: opts.active !== false };
        const wantsActive = q.filters().some((f) => f.col === "is_active" && f.val === true);
        return wantsActive && !row.is_active ? [] : [row];
      },
      fleetpal_webhook_deliveries: (q) =>
        q.write && opts.claimConflict && q.ops.some((o) => o.method === "insert")
          ? { data: null, error: { code: "23505", message: "duplicate" } }
          : [],
    },
  });
}

describe("receiveDelivery", () => {
  it("accepts a correctly signed delivery and claims its delivery id", async () => {
    const rec = recorder();
    expect(await receiveDelivery(rec.client, env, ORG, body, headers(), NOW)).toEqual({ status: 200, reason: "accepted" });
    expect(rec.writtenRows("fleetpal_webhook_deliveries")[0]).toMatchObject({ org_id: ORG, delivery_id: "dlv-1", event_key: "work_order.closed" });
    expectOrgScoped(rec, ORG);
  });

  it("⚠ rejects a forged signature, and writes nothing", async () => {
    const rec = recorder();
    const forged = headers({ signature: sign(String(NOW / 1000), body, "somebody-elses-secret") });
    expect(await receiveDelivery(rec.client, env, ORG, body, forged, NOW)).toEqual({ status: 401, reason: "unverifiable" });
    expect(rec.writes()).toHaveLength(0);
  });

  it("rejects a body changed after signing — the signature is over the raw bytes", async () => {
    const rec = recorder();
    const tampered = Buffer.from(body.toString().replace("999", "1"));
    expect((await receiveDelivery(rec.client, env, ORG, tampered, headers(), NOW)).status).toBe(401);
  });

  it("rejects a delivery signed more than five minutes away, to blunt a captured replay", async () => {
    const rec = recorder();
    const old = String(NOW / 1000 - 6 * 60);
    expect((await receiveDelivery(rec.client, env, ORG, body, headers({ timestamp: old, signature: sign(old, body) }), NOW)).status).toBe(401);
  });

  it("rejects an event whose subscription is paused — a paused secret verifies nothing", async () => {
    expect((await receiveDelivery(recorder({ active: false }).client, env, ORG, body, headers(), NOW)).status).toBe(401);
  });

  it("⚠ a replayed X-Fleetpal-Delivery is a no-op: answered 200 so FleetPal stops, and the sweep is not asked again", async () => {
    const rec = recorder({ claimConflict: true });
    expect(await receiveDelivery(rec.client, env, ORG, body, headers(), NOW)).toEqual({ status: 200, reason: "duplicate" });
  });

  it("⚠ an out-of-order retry cannot overwrite newer state: a delivery writes only its own claim, never a payload", async () => {
    const rec = recorder();
    const older = headers({ delivery: "dlv-older", eventTimestamp: "2026-11-16T10:00:00Z" });
    await receiveDelivery(rec.client, env, ORG, body, older, NOW);
    expect(new Set(rec.writes().map((q) => q.table))).toEqual(new Set(["fleetpal_webhook_deliveries"]));
  });

  it("reads the signing time as epoch seconds, epoch milliseconds or ISO", () => {
    expect(signedAtMs("1700000000")).toBe(1_700_000_000_000);
    expect(signedAtMs("1700000000000")).toBe(1_700_000_000_000);
    expect(signedAtMs("2026-11-16T20:00:00Z")).toBe(NOW);
    expect(signedAtMs("yesterday")).toBeNull();
  });

  it("verifies in constant time and refuses a signature of the wrong length", () => {
    expect(verifyFleetpalSignature(SECRET, "1", body, "sha256=abc")).toBe(false);
  });
});

describe("subscribeAll / unsubscribeAll", () => {
  const client = (fail?: string) => {
    const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    let n = 0;
    return {
      calls,
      client: {
        send: vi.fn(async (method: string, path: string, b: Record<string, unknown>) => {
          calls.push({ method, path, body: b });
          if (fail && b.event_key === fail) throw new Error("FleetPal said no");
          n += 1;
          return { id: `sub-${n}`, event_key: b.event_key, target_url: b.target_url, is_active: b.is_active ?? true, secret: `secret-${n}` };
        }),
      } as never,
    };
  };

  it("creates one subscription per event, pointing at this org's receiver, and stores every secret sealed", async () => {
    const rec = createSupabaseRecorder({ tables: { fleetpal_webhook_subscriptions: [] } });
    const fp = client();
    const r = await subscribeAll(rec.client, env, ORG, fp.client);
    expect(r).toMatchObject({ activated: [...FLEETPAL_WEBHOOK_EVENTS], failed: [] });
    expect(fp.calls[0]).toMatchObject({ method: "POST", body: { target_url: `https://api.example.test/api/webhooks/fleetpal/${ORG}` } });
    const rows = rec.writtenRows("fleetpal_webhook_subscriptions");
    expect(rows).toHaveLength(FLEETPAL_WEBHOOK_EVENTS.length);
    expect(JSON.stringify(rows)).not.toContain("secret-1");
  });

  it("reactivates a paused subscription rather than creating a second one", async () => {
    const rec = createSupabaseRecorder({
      tables: { fleetpal_webhook_subscriptions: [{ id: "s1", subscription_id: "sub-old", event_key: "work_order.closed", secret_sealed: sealed, is_active: false }] },
    });
    const fp = client();
    await subscribeAll(rec.client, env, ORG, fp.client);
    expect(fp.calls.filter((c) => c.path.includes("sub-old"))).toEqual([expect.objectContaining({ method: "PATCH", body: expect.objectContaining({ is_active: true }) })]);
    expect(fp.calls.filter((c) => c.method === "POST")).toHaveLength(FLEETPAL_WEBHOOK_EVENTS.length - 1);
  });

  it("pauses at FleetPal a subscription whose secret could not be stored, and reports the event", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        fleetpal_webhook_subscriptions: (q) =>
          q.ops.some((o) => o.method === "insert") ? { data: null, error: { code: "23514", message: "check" } } : [],
      },
    });
    const fp = client();
    const r = await subscribeAll(rec.client, env, ORG, fp.client);
    expect((r as { failed: unknown[] }).failed).toHaveLength(FLEETPAL_WEBHOOK_EVENTS.length);
    expect(fp.calls.filter((c) => c.method === "PATCH" && c.body.is_active === false)).toHaveLength(FLEETPAL_WEBHOOK_EVENTS.length);
  });

  it("says who to ask when FleetPal's role policy refuses the key (403), with FleetPal's own words", async () => {
    const rec = createSupabaseRecorder({ tables: { fleetpal_webhook_subscriptions: [] } });
    const refused = { send: vi.fn(async () => { throw new FleetpalError('Access denied by policy "webhook-subscriptions"', "forbidden", 403); }) } as never;
    const r = (await subscribeAll(rec.client, env, ORG, refused)) as { activated: string[]; failed: Array<{ event: string; error: string }> };
    expect(r.activated).toEqual([]);
    expect(r.failed).toHaveLength(FLEETPAL_WEBHOOK_EVENTS.length);
    expect(r.failed[0]!.error).toContain("Ask FleetPal support to allow webhook subscriptions");
    expect(r.failed[0]!.error).toContain('Access denied by policy "webhook-subscriptions"');
    expect(rec.writtenRows("fleetpal_webhook_subscriptions")).toEqual([]);
  });

  it("refuses to subscribe without a public address", async () => {
    const rec = createSupabaseRecorder({ tables: {} });
    expect(await subscribeAll(rec.client, testEnv({ SECRETS_ENCRYPTION_KEY: env.SECRETS_ENCRYPTION_KEY, PUBLIC_API_URL: undefined }), ORG, client().client)).toEqual({
      error: "PUBLIC_API_URL is not set, so FleetPal has no address to call.",
    });
  });

  it("off pauses every active subscription and keeps its secret", async () => {
    const rec = createSupabaseRecorder({
      tables: { fleetpal_webhook_subscriptions: [{ id: "s1", subscription_id: "sub-1", event_key: "work_order.closed", secret_sealed: sealed, is_active: true }] },
    });
    const fp = client();
    await unsubscribeAll(rec.client, ORG, fp.client);
    expect(fp.calls).toEqual([{ method: "PATCH", path: "/v1/webhook-subscriptions/sub-1/", body: { is_active: false } }]);
    expect(rec.writtenRows("fleetpal_webhook_subscriptions")).toEqual([{ is_active: false }]);
  });
});
