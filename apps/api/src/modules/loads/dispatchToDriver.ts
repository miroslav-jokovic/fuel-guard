import type { SupabaseClient } from "@supabase/supabase-js";
import {
  composeLoadDispatchSms,
  type DispatchSmsStop,
  type LoadDispatch,
  type LoadDispatchPreview,
  type LoadDispatchSmsReason,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { smsConfigured } from "../../lib/sms.js";
import { organizationTimezone } from "../idle/index.js";
import type { DispatchResult } from "./dispatchLoads/shared.js";

/**
 * Dispatch — the office sends a McLeod load to a driver (LOADS-MIRROR-PLAN.md LR-D2; D-LMR5, D-LMR6).
 *
 * It does not write the load. `loads` is McLeod's and every sync overwrites it (D-LMR2), so the act is
 * an append-only `load_dispatches` row (0370): who sent which load to whom, when, the exact text, and
 * what became of it. Re-sending, or sending to somebody other than McLeod's driver, is a new row.
 *
 * ── THE TEXT IS NEVER SENT HERE YET, AND THAT IS THE RULING, NOT AN OMISSION ──────────────────────
 * `lib/sms.ts` sends bytes to a number and asks no questions; every decision about WHETHER lives with
 * its caller (`applicationSms.ts`). Consent is the one that cannot be skipped, and the only consent
 * instrument this product has, `SMS_CONSENT`, is limited in its own words to "messages about your own
 * application". A load sheet is not that, so texting one on it would be sending without consent the
 * day Telnyx gets a number. Until Q-LMR9 is ruled (dispatch consent wording, and the 10DLC campaign
 * use-case that covers it) the answer is recorded, never assumed:
 *
 *   · SMS not configured (today)      → `not_sent` / `sms_not_configured`
 *   · SMS configured, no dispatch consent → `not_sent` / `no_dispatch_consent`
 *
 * The row is still written in both cases: the dispatcher's decision is the fact D-LMR5 asks for, and it
 * is what the driver app will read ("loads sent to me"). How the text goes is a separate outcome.
 */

const CLOSED = new Set(["delivered", "canceled"]);

type Unit = { unit_number: string } | { unit_number: string }[] | null;
const unit = (u: Unit): string | null => (Array.isArray(u) ? (u[0]?.unit_number ?? null) : (u?.unit_number ?? null));

/** A preview IS the prepared dispatch: what the modal shows is exactly what Send stores. */
type Prepared = LoadDispatchPreview;

/** Why a text will not go out — see the header. Never null today: no path sends yet. */
function smsHold(env: Env): LoadDispatchSmsReason {
  return smsConfigured(env) ? "no_dispatch_consent" : "sms_not_configured";
}

/** Everything a dispatch needs, read org-scoped, or the reason it cannot be made. */
async function prepare(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  loadId: string,
  driverId: string,
): Promise<DispatchResult<Prepared>> {
  const [loadRes, driverRes, stopsRes, orgRes] = await Promise.all([
    admin
      .from("loads")
      .select("id, ref, status, source, vehicles(unit_number), trailers(unit_number)")
      .eq("org_id", orgId)
      .eq("id", loadId)
      .maybeSingle(),
    admin.from("drivers").select("id, full_name, status").eq("org_id", orgId).eq("id", driverId).maybeSingle(),
    admin
      .from("load_stops")
      .select("seq, kind, name, location_name, city, state, appointment_start")
      .eq("org_id", orgId)
      .eq("load_id", loadId)
      .order("seq", { ascending: true }),
    admin.from("organizations").select("name, operating_hours").eq("id", orgId).maybeSingle(),
  ]);

  const load = loadRes.data as
    | { id: string; ref: string; status: string; source: string; vehicles: Unit; trailers: Unit }
    | null;
  if (!load) return { ok: false, status: 404, code: "not_found", message: "That load no longer exists" };
  // Dispatch is the McLeod path (D-LMR5). A manual load still has Release until LR6 retires both.
  if (load.source !== "tms") {
    return { ok: false, status: 409, code: "not_a_mcleod_load", message: "Only a McLeod load is dispatched" };
  }
  if (CLOSED.has(load.status)) {
    return { ok: false, status: 409, code: "load_closed", message: "This load is already delivered or canceled" };
  }
  const driver = driverRes.data as { id: string; full_name: string; status: string } | null;
  if (!driver || driver.status !== "active") {
    return { ok: false, status: 422, code: "unknown_driver", message: "That driver is not an active driver here" };
  }

  const org = orgRes.data as { name?: string; operating_hours?: object | null } | null;
  const stops = ((stopsRes.data ?? []) as {
    seq: number;
    kind: string;
    name: string | null;
    location_name: string | null;
    city: string | null;
    state: string | null;
    appointment_start: string | null;
  }[])
    .filter((s) => s.kind === "pickup" || s.kind === "dropoff")
    .map<DispatchSmsStop>((s) => ({
      seq: s.seq,
      kind: s.kind as DispatchSmsStop["kind"],
      name: s.location_name ?? s.name ?? "",
      city: s.city,
      state: s.state,
      appointmentStart: s.appointment_start,
    }));

  return {
    ok: true,
    data: {
      loadId: load.id,
      driverId: driver.id,
      driverName: driver.full_name,
      body: composeLoadDispatchSms({
        carrierName: org?.name ?? "Dispatch",
        loadRef: load.ref,
        truck: unit(load.vehicles),
        trailer: unit(load.trailers),
        stops,
        timeZone: organizationTimezone(org?.operating_hours),
      }),
      smsHeldBecause: smsHold(env),
    },
  };
}

/** The modal's preview: the exact text Send would store, and whether it would be texted. */
export async function previewLoadDispatch(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  loadId: string,
  driverId: string,
): Promise<DispatchResult<LoadDispatchPreview>> {
  return prepare(admin, env, orgId, loadId, driverId);
}

/** Send: one `load_dispatches` row, its SMS outcome recorded as it is. */
export async function dispatchLoad(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  actorId: string,
  loadId: string,
  driverId: string,
): Promise<DispatchResult<LoadDispatch>> {
  const prepared = await prepare(admin, env, orgId, loadId, driverId);
  if (!prepared.ok) return prepared;
  const p = prepared.data;

  const { data, error } = await admin
    .from("load_dispatches")
    .insert({
      org_id: orgId,
      load_id: p.loadId,
      driver_id: p.driverId,
      sent_by: actorId,
      channel: "sms",
      outcome: "not_sent",
      outcome_reason: p.smsHeldBecause,
      recipient: null,
      body: p.body,
      provider_message_id: null,
    })
    .select("id, sent_at")
    .single();
  if (error || !data) throw new Error(`load dispatch insert failed: ${error?.message ?? "no row"}`);

  const row = data as { id: string; sent_at: string };
  return {
    ok: true,
    data: {
      id: row.id,
      loadId: p.loadId,
      driverId: p.driverId,
      driverName: p.driverName,
      sentBy: actorId,
      sentAt: row.sent_at,
      channel: "sms",
      outcome: "not_sent",
      outcomeReason: p.smsHeldBecause,
      body: p.body,
    },
  };
}
