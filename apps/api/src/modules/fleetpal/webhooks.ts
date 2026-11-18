import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FLEETPAL_WEBHOOK_EVENTS,
  fleetpalWebhookSubscriptionCreatedSchema,
  type FleetpalInstantUpdates,
} from "@silvicom/shared";
import { z } from "zod";
import type { Env } from "../../env.js";
import { isSecretBoxConfigured, open, seal, secretAad } from "../../lib/secretBox.js";
import type { FleetpalClient } from "./client.js";
import { claimDelivery, finishDelivery } from "./deliveries.js";
import { FleetpalError } from "./errors.js";

/**
 * FleetPal webhooks (FLEETPAL-INTEGRATION-PLAN.md F15; D-FP10, §2.8).
 *
 * ── A WAKE-UP, NEVER A SOURCE OF TRUTH ────────────────────────────────────────────────────────
 * A verified delivery does exactly two things: claims its `X-Fleetpal-Delivery` id in
 * `fleetpal_webhook_deliveries` (a retry is then a no-op), and asks for the ordinary sweep to run now.
 * Nothing in the body is written anywhere. That is also the whole answer to ordering: the vendor warns
 * that a retried old event arrives signed NEWER than one that succeeded first time, and a receiver that
 * applied payloads in arrival order would overwrite newer work-order state with older. This receiver
 * applies nothing, so there is no state for a late delivery to overwrite — the sweep reads what is true
 * now through the authenticated API, watermarked as always.
 *
 * ── VERIFICATION, BY THE VENDOR'S RULE ────────────────────────────────────────────────────────
 * `X-Fleetpal-Signature` is `sha256=` + hex HMAC-SHA256 over `"{X-Fleetpal-Timestamp}.{raw body}"`,
 * keyed with THAT subscription's secret, compared in constant time. A delivery signed more than five
 * minutes from now is refused, to blunt a replay of a captured request. An unverifiable delivery is a
 * 401, never accepted quietly (D-FP10).
 *
 * ── ONE SECRET PER EVENT, RETURNED ONCE ───────────────────────────────────────────────────────
 * FleetPal returns a subscription's secret in the create response and never again, and it has no
 * DELETE — only `is_active`. So: turning instant updates OFF pauses each subscription and keeps its
 * sealed secret; turning them ON reactivates a paused one before creating anything new, and a new
 * one's secret is sealed in the same request. A secret we fail to store makes that subscription
 * unverifiable, so it is paused at FleetPal at once rather than left delivering to a 401.
 */

const AAD_PURPOSE = "fleetpal.webhook_secret";
export const MAX_SIGNATURE_SKEW_MS = 5 * 60 * 1000;

export function receiverUrl(env: Pick<Env, "PUBLIC_API_URL">, orgId: string): string | null {
  if (!env.PUBLIC_API_URL) return null;
  return `${env.PUBLIC_API_URL.replace(/\/+$/, "")}/api/webhooks/fleetpal/${orgId}`;
}

/** When the attempt was signed, as epoch ms: epoch seconds, epoch ms, or ISO 8601 — the spec names none. */
export function signedAtMs(timestamp: string): number | null {
  const t = timestamp.trim();
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    return n > 1e12 ? n : n * 1000;
  }
  const parsed = Date.parse(t);
  return Number.isNaN(parsed) ? null : parsed;
}

export function verifyFleetpalSignature(secret: string, timestamp: string, rawBody: Buffer, signature: string): boolean {
  const mac = crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
  const expected = Buffer.from(`sha256=${mac}`);
  const got = Buffer.from(signature);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

export interface DeliveryHeaders {
  event?: string;
  delivery?: string;
  eventTimestamp?: string;
  timestamp?: string;
  signature?: string;
}

export type DeliveryOutcome =
  | { status: 401; reason: "unverifiable" }
  | { status: 200; reason: "duplicate" | "accepted" }
  | { status: 500; reason: "ledger_failed" };

interface SubscriptionRow {
  id: string;
  subscription_id: string;
  event_key: string;
  secret_sealed: string;
  is_active: boolean;
}

/**
 * Verify and claim one delivery. The caller answers FleetPal with `status` and, on `accepted`, wakes
 * the sweep AFTER answering — a sweep can take minutes, and FleetPal retries a slow endpoint.
 */
export async function receiveDelivery(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  rawBody: Buffer | undefined,
  h: DeliveryHeaders,
  now: number = Date.now(),
): Promise<DeliveryOutcome> {
  const refuse = { status: 401, reason: "unverifiable" } as const;
  // No signature over bytes we no longer hold: a re-serialised body verifies by luck or not at all.
  if (!rawBody || !h.event || !h.delivery || !h.timestamp || !h.signature) return refuse;
  const signedAt = signedAtMs(h.timestamp);
  if (signedAt === null || Math.abs(now - signedAt) > MAX_SIGNATURE_SKEW_MS) return refuse;

  const { data, error } = await admin
    .from("fleetpal_webhook_subscriptions")
    .select("id, subscription_id, event_key, secret_sealed, is_active")
    .eq("org_id", orgId)
    .eq("event_key", h.event)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return refuse;
  let secret: string;
  try {
    secret = open(env, (data as SubscriptionRow).secret_sealed, secretAad(orgId, AAD_PURPOSE));
  } catch {
    return refuse;
  }
  if (!verifyFleetpalSignature(secret, h.timestamp, rawBody, h.signature)) return refuse;

  const eventAt = h.eventTimestamp && !Number.isNaN(Date.parse(h.eventTimestamp)) ? h.eventTimestamp : new Date(now).toISOString();
  const claim = await claimDelivery(admin, orgId, { deliveryId: h.delivery, eventKey: h.event, eventAt });
  if (claim.error) return { status: 500, reason: "ledger_failed" };
  if (!claim.claimed) return { status: 200, reason: "duplicate" };
  await finishDelivery(admin, orgId, h.delivery, { status: "processed", note: "woke the sweep" });
  return { status: 200, reason: "accepted" };
}

const subscriptionAck = z.looseObject({ id: z.string(), is_active: z.boolean() });

export interface SubscribeResult {
  activated: string[];
  failed: Array<{ event: string; error: string }>;
}

/** Turn instant updates on: every F15 event gets an active, verifiable subscription. */
export async function subscribeAll(admin: SupabaseClient, env: Env, orgId: string, client: FleetpalClient): Promise<SubscribeResult | { error: string }> {
  const target = receiverUrl(env, orgId);
  if (!target) return { error: "PUBLIC_API_URL is not set, so FleetPal has no address to call." };
  if (!isSecretBoxConfigured(env)) return { error: "SECRETS_ENCRYPTION_KEY is not set, so a webhook secret cannot be stored." };
  const { data, error } = await admin
    .from("fleetpal_webhook_subscriptions")
    .select("id, subscription_id, event_key, secret_sealed, is_active")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };
  const rows = (data ?? []) as SubscriptionRow[];

  const result: SubscribeResult = { activated: [], failed: [] };
  for (const event of FLEETPAL_WEBHOOK_EVENTS) {
    try {
      if (rows.some((r) => r.event_key === event && r.is_active)) {
        result.activated.push(event);
        continue;
      }
      const paused = rows.find((r) => r.event_key === event && !r.is_active);
      if (paused) {
        await client.send("PATCH", `/v1/webhook-subscriptions/${paused.subscription_id}/`, { is_active: true, target_url: target }, subscriptionAck);
        const up = await admin.from("fleetpal_webhook_subscriptions").update({ is_active: true, target_url: target }).eq("org_id", orgId).eq("id", paused.id);
        if (up.error) throw new Error(up.error.message);
        result.activated.push(event);
        continue;
      }
      const created = await client.send("POST", "/v1/webhook-subscriptions/", { event_key: event, target_url: target, is_active: true }, fleetpalWebhookSubscriptionCreatedSchema);
      const ins = await admin.from("fleetpal_webhook_subscriptions").insert({
        org_id: orgId,
        subscription_id: created.id,
        event_key: event,
        target_url: target,
        secret_sealed: seal(env, created.secret, secretAad(orgId, AAD_PURPOSE)),
        is_active: true,
      });
      if (ins.error) {
        // The secret is gone with this request. Pause the subscription rather than leave FleetPal
        // delivering events every one of which we would have to refuse.
        await client.send("PATCH", `/v1/webhook-subscriptions/${created.id}/`, { is_active: false }, subscriptionAck).catch(() => undefined);
        throw new Error(`the secret could not be stored: ${ins.error.message}`);
      }
      result.activated.push(event);
    } catch (e) {
      result.failed.push({ event, error: subscribeFailure(e) });
    }
  }
  return result;
}

/**
 * The sentence an admin reads when FleetPal refuses a subscription. A 403 is FleetPal's role policy, not
 * ours: measured 2026-11-18, the carrier's key reads every collection the sweep needs and is refused
 * `POST /v1/webhook-subscriptions/` with "Access denied by policy \"webhook-subscriptions\"" — keys
 * carry their FleetPal user's role, and that role may not write subscriptions. Only FleetPal support
 * can change it, so the sentence says who to ask and keeps FleetPal's own words beside it.
 */
export function subscribeFailure(e: unknown): string {
  if (e instanceof FleetpalError && e.status === 403) {
    return `FleetPal does not let this API key register updates (FleetPal said: ${e.message}). Ask FleetPal support to allow webhook subscriptions for the key's user, or to issue a key from a user who may, then store it here and try again.`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Turn instant updates off: pause every active subscription; keep the sealed secrets for the way back on. */
export async function unsubscribeAll(admin: SupabaseClient, orgId: string, client: FleetpalClient): Promise<SubscribeResult | { error: string }> {
  const { data, error } = await admin
    .from("fleetpal_webhook_subscriptions")
    .select("id, subscription_id, event_key, secret_sealed, is_active")
    .eq("org_id", orgId)
    .eq("is_active", true);
  if (error) return { error: error.message };
  const result: SubscribeResult = { activated: [], failed: [] };
  for (const row of (data ?? []) as SubscriptionRow[]) {
    try {
      await client.send("PATCH", `/v1/webhook-subscriptions/${row.subscription_id}/`, { is_active: false }, subscriptionAck);
      const up = await admin.from("fleetpal_webhook_subscriptions").update({ is_active: false }).eq("org_id", orgId).eq("id", row.id);
      if (up.error) throw new Error(up.error.message);
    } catch (e) {
      result.failed.push({ event: row.event_key, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

/** What the settings page shows. */
export async function readInstantUpdates(admin: SupabaseClient, env: Pick<Env, "PUBLIC_API_URL">, orgId: string): Promise<FleetpalInstantUpdates> {
  const [subs, last] = await Promise.all([
    admin.from("fleetpal_webhook_subscriptions").select("event_key").eq("org_id", orgId).eq("is_active", true),
    admin.from("fleetpal_webhook_deliveries").select("event_at").eq("org_id", orgId).order("event_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const events = ((subs.data ?? []) as Array<{ event_key: string }>).map((r) => r.event_key).sort();
  return {
    on: FLEETPAL_WEBHOOK_EVENTS.every((e) => events.includes(e)),
    events,
    publicUrlConfigured: Boolean(env.PUBLIC_API_URL),
    lastDeliveryAt: (last.data as { event_at?: string } | null)?.event_at ?? null,
  };
}
