/**
 * Home time's quarter-hourly job (HOME-TIME-PLAN D-HT6, D-HT12, D-HT13): close the periods that have
 * plainly ended, then tell the right people about the ones that have not.
 *
 * ── WHY IT LIVES IN `livemap` ────────────────────────────────────────────────────────────────────
 * It composes four owners, as the dispatch board does and through the same indexes: the periods and
 * the truck's fleet from roster, the pickups from loads, the fleet's dispatcher from mcleod, the
 * carrier's clock from org — and hands the result to messaging's one sender. `roster` cannot hold it:
 * `loads -> roster` exists, so `roster -> loads` would close a cycle.
 *
 * ── ONE RUN, IN THIS ORDER ───────────────────────────────────────────────────────────────────────
 * 1. A driver no longer on the roster: his period ends (`driver_left`). Nobody is waiting for him.
 * 2. A driver with a PICKUP after his period started: it ends at that pickup (`load_evidence`,
 *    D-HT6). An overstay alert about a driver who is hauling is the false alarm that taught the office
 *    to ignore the bell. A dispatcher can reopen it; the audit row names the load.
 * 3. What is still live: the three alerts that are due (`homeTimeAlertsDue`, pure), each to whoever
 *    marked the period and the dispatcher who runs the truck's fleet, plus whatever the carrier's
 *    routes add (`sendAlerts`). Dedupe is the sender's: a run every fifteen minutes says a fact once.
 *
 * ── LIGHT, AND ONE PROCESS ───────────────────────────────────────────────────────────────────────
 * One read of the live periods per org; a carrier with nobody home costs that read and nothing else.
 * Started from `SCHEDULERS`, so the lane's lease runs it in exactly one process
 * (`docs/WORKER-DEPLOYMENT.md`). `HOME_TIME_ALERT_MINUTES=0` turns it off. A carrier without the
 * Dispatch module is skipped: it has no board to mark home time on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HOME_TIME_ALERT_SEVERITY,
  formatDisplayDateTime,
  homeTimeAlertLine,
  homeTimeAlertsDue,
  type AlertKey,
  type HomeTimePeriod,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { writeAudit } from "../../lib/audit.js";
import {
  endHomeTime,
  hydrateHomeTimes,
  isHomeTimeRefusal,
  readDriversOffRoster,
  readFleetIdentities,
  readHomeTimeSettings,
  readLiveHomeTimes,
  type HomeTimeRow,
} from "../roster/index.js";
import { readDriverPickupsSince } from "../loads/index.js";
import { readFleetDispatchers } from "../mcleod/index.js";
import { orgTimezone } from "../org/index.js";
import { sendAlerts, type AlertEvent } from "../messaging/index.js";

const BOOT_DELAY_MS = 150_000;

export interface HomeTimeRunResult {
  /** Periods the run closed because the driver left the company, or was on a new load. */
  endedLeft: number;
  endedOnLoad: number;
  /** Bell items and emails that actually went out (a deduped one is not counted). */
  bells: number;
  emails: number;
}

/** What the job decided, said by the job: the reason and the end are its own, not read back from the row. */
async function auditAutoEnd(admin: SupabaseClient, orgId: string, period: HomeTimePeriod, meta: { reason: "driver_left" | "load_evidence"; endAt: string } & Record<string, unknown>): Promise<void> {
  await writeAudit(admin, {
    orgId,
    actorId: null,
    action: "home_time.auto_ended",
    entity: "driver_time_off",
    entityId: period.id,
    meta: { driverId: period.driverId, vehicleId: period.vehicleId, expectedReturnAt: period.expectedReturnAt, ...meta },
  });
}

/** One carrier, one run. Exported for the tests; the scheduler below calls it for every org. */
export async function runHomeTimeOnce(admin: SupabaseClient, env: Env, orgId: string, now: Date = new Date()): Promise<HomeTimeRunResult> {
  const result: HomeTimeRunResult = { endedLeft: 0, endedOnLoad: 0, bells: 0, emails: 0 };
  const rows = (await readLiveHomeTimes(admin, orgId)).filter((r): r is HomeTimeRow & { driver_id: string } => !!r.driver_id);
  if (rows.length === 0) return result;
  const { data: entitled, error: moduleError } = await admin.rpc("org_module_enabled", { p_org: orgId, p_module: "dispatch" });
  if (moduleError) throw new Error(`org_module_enabled: ${moduleError.message}`);
  if (entitled !== true) return result;

  const closed = new Set<string>();

  // 1. The driver left the company.
  const off = await readDriversOffRoster(admin, orgId, rows.map((r) => r.driver_id));
  for (const r of rows) {
    if (!off.has(r.driver_id)) continue;
    // A period that has not started cannot be ended (it has no span); it stays scheduled and silent —
    // the alerts below only speak about a driver who is home — until somebody cancels it.
    if (Date.parse(r.start_at) > now.getTime()) continue;
    const ended = await endHomeTime(admin, orgId, null, r.id, "driver_left", now, now);
    if (isHomeTimeRefusal(ended)) continue;
    closed.add(r.id);
    result.endedLeft += 1;
    await auditAutoEnd(admin, orgId, ended, { reason: "driver_left", endAt: now.toISOString() });
  }

  // 2. The driver is on a new load: a pickup after his period started.
  const started = rows.filter((r) => !closed.has(r.id) && Date.parse(r.start_at) <= now.getTime());
  if (started.length > 0) {
    const earliest = new Date(Math.min(...started.map((r) => Date.parse(r.start_at))));
    const pickups = await readDriverPickupsSince(admin, orgId, earliest);
    for (const r of started) {
      const startMs = Date.parse(r.start_at);
      // The first pickup of his after the period began, and not one McLeod has keyed ahead of the clock.
      const first = pickups
        .filter((p) => (p.driverId === r.driver_id || p.coDriverId === r.driver_id) && Date.parse(p.at) > startMs && Date.parse(p.at) <= now.getTime())
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
      if (!first) continue;
      const ended = await endHomeTime(admin, orgId, null, r.id, "load_evidence", new Date(first.at), now);
      if (isHomeTimeRefusal(ended)) continue;
      closed.add(r.id);
      result.endedOnLoad += 1;
      await auditAutoEnd(admin, orgId, ended, { reason: "load_evidence", endAt: first.at, loadId: first.loadId, loadRef: first.loadRef, pickupAt: first.at });
    }
  }

  // 3. The alerts that are due on what is still live.
  const live = rows.filter((r) => !closed.has(r.id));
  if (live.length === 0) return result;
  const [settings, periods, zone, identities, links] = await Promise.all([
    readHomeTimeSettings(admin, orgId),
    hydrateHomeTimes(admin, orgId, live, now),
    orgTimezone(admin, orgId),
    readFleetIdentities(admin, orgId),
    readFleetDispatchers(admin, orgId),
  ]);
  const rowOf = new Map(live.map((r) => [r.id, r]));
  /** The account of the dispatcher who runs this truck's fleet, or null: fleet → McLeod login → our user. */
  const dispatcherOf = (vehicleId: string | null): string | null => {
    const fleetCode = vehicleId ? (identities.byVehicleId.get(vehicleId)?.fleetCode ?? null) : null;
    const login = fleetCode ? (links.fleets.find((f) => f.code === fleetCode)?.dispatcherId ?? null) : null;
    return login ? (links.dispatchers.find((d) => d.id === login && d.isActive)?.userId ?? null) : null;
  };

  const byAlert = new Map<AlertKey, AlertEvent[]>();
  for (const p of periods) {
    const row = rowOf.get(p.id);
    if (!row) continue;
    for (const alert of homeTimeAlertsDue(p, settings, now)) {
      const event: AlertEvent = {
        dedupeKey: alert.dedupeKey,
        line: homeTimeAlertLine(alert, p, now, formatDisplayDateTime(p.expectedReturnAt, "", zone)),
        severity: HOME_TIME_ALERT_SEVERITY[alert.kind],
        // The driver, so the bell opens his home time (`notificationRoute`).
        entityType: "driver",
        entityId: p.driverId,
        relations: { marked_by: row.created_by, truck_dispatcher: dispatcherOf(p.vehicleId) },
      };
      byAlert.set(alert.kind, [...(byAlert.get(alert.kind) ?? []), event]);
    }
  }
  for (const [alert, events] of byAlert) {
    const sent = await sendAlerts(admin, env, orgId, alert, events);
    result.bells += sent.bells;
    result.emails += sent.emails;
  }
  return result;
}

export function startHomeTimeScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  if (env.HOME_TIME_ALERT_MINUTES <= 0) return;

  let inFlight = false;
  const run = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const admin = getSupabaseAdmin(env);
      const { data, error } = await admin.from("organizations").select("id");
      if (error) throw new Error(error.message);
      for (const { id } of (data ?? []) as { id: string }[]) {
        try {
          const r = await runHomeTimeOnce(admin, env, id);
          if (r.endedLeft + r.endedOnLoad + r.bells + r.emails > 0) {
            console.log(`[home-time] org ${id}: ended ${r.endedOnLoad} on a load, ${r.endedLeft} left; ${r.bells} bell item(s), ${r.emails} email(s)`);
          }
        } catch (e) {
          console.error(`[home-time] run failed for org ${id}:`, e instanceof Error ? e.message : e);
        }
      }
    } catch (e) {
      console.error("[home-time] run failed:", e instanceof Error ? e.message : e);
    } finally {
      inFlight = false;
    }
  };

  const boot = setTimeout(() => void run(), BOOT_DELAY_MS);
  boot.unref?.();
  const timer = setInterval(() => void run(), env.HOME_TIME_ALERT_MINUTES * 60_000);
  timer.unref?.();
  console.log(`[home-time] alert job enabled, every ${env.HOME_TIME_ALERT_MINUTES} min`);
}
