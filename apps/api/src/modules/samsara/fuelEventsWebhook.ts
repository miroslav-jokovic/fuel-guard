import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { makeSender } from "../../lib/mailer.js";

export interface SamsaraWebhookHeaders {
  signature?: string; // X-Samsara-Signature: "v1=<hex>"
  timestamp?: string; // X-Samsara-Timestamp
}

/**
 * Verify a Samsara webhook (docs: HMAC-SHA256 over "v1:<timestamp>:<rawBody>", secret is base64).
 * Fail-closed: no secret / no headers → not verified.
 */
export function verifySamsaraSignature(env: Env, rawBody: Buffer, headers: SamsaraWebhookHeaders): boolean {
  if (!env.SAMSARA_WEBHOOK_SECRET || !headers.signature || !headers.timestamp) return false;
  const secret = Buffer.from(env.SAMSARA_WEBHOOK_SECRET, "base64");
  const mac = crypto.createHmac("sha256", secret).update(`v1:${headers.timestamp}:`).update(rawBody).digest("hex");
  const expected = Buffer.from(`v1=${mac}`);
  const got = Buffer.from(headers.signature);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

type Json = Record<string, unknown>;

/** Recursively find the first nested object under any of `keyNames` that carries a string `id`. */
function deepFindId(obj: unknown, keyNames: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj as Json)) {
    if (keyNames.includes(k.toLowerCase()) && v && typeof v === "object") {
      const id = (v as Json).id;
      if (typeof id === "string" && id) return id;
    }
  }
  for (const v of Object.values(obj as Json)) {
    const hit = deepFindId(v, keyNames);
    if (hit) return hit;
  }
  return null;
}

/** Recursively find a numeric value whose key matches `re`. */
function deepFindNumber(obj: unknown, re: RegExp): number | null {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj as Json)) {
    if (re.test(k) && (typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v))))) {
      return Number(v);
    }
  }
  for (const v of Object.values(obj as Json)) {
    const hit = deepFindNumber(v, re);
    if (hit != null) return hit;
  }
  return null;
}

export interface ParsedFuelEvent {
  eventId: string | null;
  happenedAt: string;
  samsaraVehicleId: string | null;
  isFuelDrop: boolean;
  dropPct: number | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
}

/** Parse a Samsara alert webhook into a fuel-drop event (defensive — schema varies across versions). */
export function parseSamsaraFuelEvent(body: Json): ParsedFuelEvent {
  const data = (body.data ?? body.event ?? {}) as Json;
  const text = JSON.stringify(body).toLowerCase();
  const isFuel = text.includes("fuel");
  const isRise = /rise|increase|refuel|refill|filled/.test(text);
  const happenedAt =
    (typeof data.happenedAtTime === "string" && data.happenedAtTime) ||
    (typeof body.eventTime === "string" && body.eventTime) ||
    (body.eventMs != null ? new Date(Number(body.eventMs)).toISOString() : null) ||
    new Date().toISOString();

  return {
    eventId: (typeof body.eventId === "string" && body.eventId) || (typeof data.id === "string" && data.id) || null,
    happenedAt,
    samsaraVehicleId: deepFindId(body, ["vehicle"]) ?? deepFindId(body, ["device"]),
    isFuelDrop: isFuel && !isRise,
    dropPct: deepFindNumber(data, /drop|decrease/i),
    lat: deepFindNumber(body, /^lat|latitude/i),
    lng: deepFindNumber(body, /^lon|^lng|longitude/i),
    address:
      (typeof (data.formattedLocation ?? data.address) === "string" && (data.formattedLocation ?? data.address)) as
        | string
        | null,
  };
}

export interface WebhookResult {
  ok: boolean;
  stored: boolean;
  reason?: string;
}

/**
 * Verify + ingest a Samsara webhook. A sudden fuel-level DROP is fuel leaving the tank with no purchase
 * — a direct siphoning signal — so we store it (idempotent on eventId) against the mapped vehicle/org and
 * email the org's recipients. Best-effort and fail-closed on signature.
 */
export async function processSamsaraWebhook(
  admin: SupabaseClient,
  env: Env,
  rawBody: Buffer,
  headers: SamsaraWebhookHeaders,
): Promise<WebhookResult> {
  if (!verifySamsaraSignature(env, rawBody, headers)) return { ok: false, stored: false, reason: "bad_signature" };

  let body: Json;
  try {
    body = JSON.parse(rawBody.toString("utf8")) as Json;
  } catch {
    return { ok: false, stored: false, reason: "bad_json" };
  }

  const ev = parseSamsaraFuelEvent(body);
  if (!ev.isFuelDrop) return { ok: true, stored: false, reason: "not_a_fuel_drop" };
  if (!ev.samsaraVehicleId) return { ok: true, stored: false, reason: "no_vehicle" };

  const { data: veh } = await admin
    .from("vehicles")
    .select("id, org_id, unit_number")
    .eq("samsara_vehicle_id", ev.samsaraVehicleId)
    .maybeSingle();
  if (!veh) return { ok: true, stored: false, reason: "unmapped_vehicle" };

  const { error } = await admin.from("fuel_events").upsert(
    {
      org_id: veh.org_id,
      vehicle_id: veh.id,
      samsara_vehicle_id: ev.samsaraVehicleId,
      event_type: "fuel_drop",
      happened_at: ev.happenedAt,
      drop_pct: ev.dropPct,
      lat: ev.lat,
      lng: ev.lng,
      address: ev.address,
      external_ref: ev.eventId,
      raw: body,
    },
    { onConflict: "org_id,external_ref" },
  );
  if (error) {
    console.error("[webhook] fuel_event insert failed:", error.message);
    return { ok: false, stored: false, reason: "db_error" };
  }

  void notifyFuelDrop(admin, env, veh.org_id as string, veh.unit_number as string, ev).catch(() => {});
  return { ok: true, stored: true };
}

async function notifyFuelDrop(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  unit: string,
  ev: ParsedFuelEvent,
): Promise<void> {
  const { data: org } = await admin
    .from("organizations")
    .select("name, notification_emails, notifications_enabled")
    .eq("id", orgId)
    .maybeSingle();
  if (!org || !org.notifications_enabled || !(org.notification_emails?.length > 0)) return;

  const when = new Date(ev.happenedAt).toLocaleString();
  const where = ev.address ? ` near ${ev.address}` : "";
  const mag = ev.dropPct != null ? ` (~${ev.dropPct}% drop)` : "";
  const subject = `⚠ Possible fuel theft: sudden fuel drop on ${unit}`;
  const text = `Samsara detected a sudden fuel-level drop on vehicle ${unit}${mag} at ${when}${where}. This can indicate siphoning. Review in Silvicom 360: ${env.WEB_APP_URL}/fuel-events`;
  const send = makeSender(env);
  await send({ to: org.notification_emails as string[], subject, html: `<p>${text}</p>`, text });
}

/**
 * The full path the receiver answers on, as ONE constant, because the Samsara console has to be given
 * it character for character and getting it wrong is silent.
 *
 * Measured 2026-09-01 against the live Samsara account (`GET /webhooks`): our `Fleetguardweb` webhook
 * posts to `/api/webhooks` — the mount prefix without this route — so every delivery it has ever made
 * 404'd, and `fuel_events` holds 0 rows with no error recorded anywhere. Neither end complained: the
 * vendor retries a 404 quietly and we never knew a delivery had been attempted
 * (docs/plans/HANDOFF-2026-09-01.md §5; docs/plans/samsara/SAMSARA-COLLECTION-PLAN.md §0.5 check 2).
 *
 * So this constant is what the settings card prints for an operator to paste, and the app is asserted
 * to actually route it — a future re-mount breaks a test instead of the integration.
 */
export const SAMSARA_WEBHOOK_PATH = "/api/webhooks/samsara";

/**
 * The line to log when the receiver is mounted with no secret; null when it is configured.
 *
 * WHY THIS EXISTS. `verifySamsaraSignature` fails closed on an unset secret, which is the right
 * behaviour and was also completely invisible: `SAMSARA_WEBHOOK_SECRET` is `z.string().optional()`, so
 * an unset secret is a boot with no complaint and a receiver that answers 401 to every delivery, for
 * as long as nobody thinks to check. A silent fail-closed receiver and a wrong vendor path are
 * independently sufficient to explain six months of zero events, which is exactly why neither was
 * noticed — there was no symptom to notice (SAMSARA-COLLECTION-PLAN S1).
 *
 * Boot is the cheapest place to say it, because it is the one moment somebody is already reading.
 */
export function samsaraWebhookBootWarning(env: Env): string | null {
  if (env.SAMSARA_WEBHOOK_SECRET) return null;
  return (
    `[samsara-webhook] SAMSARA_WEBHOOK_SECRET is not set — ${SAMSARA_WEBHOOK_PATH} is mounted and will ` +
    "reject EVERY delivery with 401 (fail-closed). Set it from the Samsara webhook config to receive fuel-drop events."
  );
}

/** Whether the receiver can work at all, and whether it ever has. */
export interface SamsaraWebhookStatus {
  /** The signing secret is set, so a correctly signed delivery can be accepted rather than 401'd. */
  secretConfigured: boolean;
  /** The path we listen on, and the whole URL to paste into the vendor console when we know our origin. */
  endpointPath: string;
  endpointUrl: string | null;
  /** Events received and stored for this org, EVER. */
  eventCount: number;
  lastEventAt: string | null;
}

/**
 * Read whether the webhook is configured and whether it has ever delivered anything.
 *
 * ⚠ The count is deliberately ALL-TIME rather than over a selected window (D-SAM7). A windowed zero
 * reads as a quiet week; the thing an operator needs to be able to see here is a receiver that has
 * never been reachable at all, and that is only visible against an all-time denominator.
 */
export async function readSamsaraWebhookStatus(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
): Promise<SamsaraWebhookStatus> {
  const { data, count } = await admin
    .from("fuel_events")
    .select("happened_at", { count: "exact" })
    .eq("org_id", orgId)
    .order("happened_at", { ascending: false })
    .limit(1);
  const rows = (data ?? []) as Array<{ happened_at: string }>;
  const origin = env.PUBLIC_API_URL?.replace(/\/+$/, "") ?? null;
  return {
    secretConfigured: Boolean(env.SAMSARA_WEBHOOK_SECRET),
    endpointPath: SAMSARA_WEBHOOK_PATH,
    endpointUrl: origin ? `${origin}${SAMSARA_WEBHOOK_PATH}` : null,
    eventCount: count ?? 0,
    lastEventAt: rows[0]?.happened_at ?? null,
  };
}
