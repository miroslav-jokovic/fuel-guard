/**
 * The toll GPS check's clock (TOLLS-PER-TRUCK-PLAN TL8a; register: `docs/WORKER-DEPLOYMENT.md`).
 *
 * ── ⚠ ONE PROCESS FLEET-WIDE ──────────────────────────────────────────────────────────────────
 * Started from `SCHEDULERS` on the `general` lane, so it runs where that lane's lease is held and
 * nowhere else. Two copies would not corrupt anything — an observation is unique per line, role and
 * plaza, and a plaza attempt is a row of evidence either way — but each would spend Samsara's backfill
 * budget on the same windows, and the second's writes would be refused.
 *
 * ── WHAT A TICK DOES ──────────────────────────────────────────────────────────────────────────
 * For each org with a read toll statement and a Samsara token: learn up to 20 due plazas
 * (`plazaPass.ts`), then observe tolls at placed plazas, oldest first, for up to four minutes
 * (`observationPass.ts`). Each part's failure is logged on its own and never stops the other or the
 * next org. A tick that finds nothing due costs three reads and no Samsara call.
 */
import tzlookup from "@photostructure/tz-lookup";
import type { Env } from "../../../env.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import {
  loadSamsaraToken,
  makeSamsaraTrailerGpsFetcher,
  makeSamsaraTrailerLister,
  makeSamsaraVehicleLister,
  makeSamsaraVehiclesGpsFetcher,
} from "../../samsara/index.js";
import { learnPlazas } from "./plazaPass.js";
import { observeTolls } from "./observationPass.js";

const BOOT_DELAY_MS = 11 * 60_000;

/** The tz dataset's zone at a point, or null when it names none (open sea). */
export function zoneAt(lat: number, lon: number): string | null {
  try {
    return tzlookup(lat, lon) || null;
  } catch {
    return null;
  }
}

export function startTollGpsScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  if (env.TOLL_GPS_MINUTES <= 0) return;

  let inFlight = false;
  const run = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      await tollGpsTick(env);
    } catch (e) {
      console.error("[toll-gps] tick failed:", e instanceof Error ? e.message : e);
    } finally {
      inFlight = false;
    }
  };
  const boot = setTimeout(() => void run(), BOOT_DELAY_MS);
  boot.unref?.();
  const timer = setInterval(() => void run(), env.TOLL_GPS_MINUTES * 60_000);
  timer.unref?.();
}

/** One tick over every org that has a read toll statement. */
export async function tollGpsTick(env: Env): Promise<void> {
  const admin = getSupabaseAdmin(env);
  // Which orgs have anything to check: a cross-org read by design (the service role lists the orgs it
  // works for); every query after it names its org.
  const { data, error } = await admin.from("toll_statements").select("org_id").not("read_at", "is", null).is("removed_at", null);
  if (error) throw new Error(error.message);
  const orgIds = [...new Set(((data ?? []) as { org_id: string }[]).map((r) => r.org_id))];
  for (const orgId of orgIds) {
    const token = await loadSamsaraToken(admin, env, orgId);
    if (!token) continue;
    try {
      const t = await learnPlazas(admin, orgId, { fetchGps: makeSamsaraVehiclesGpsFetcher(env, token), zoneAt });
      if (t.placed + t.not_placed > 0) console.log(`[toll-gps] org ${orgId}: plazas ${t.placed} placed, ${t.not_placed} not placed`);
    } catch (e) {
      console.error(`[toll-gps] org ${orgId}: plaza pass failed —`, e instanceof Error ? e.message : e);
    }
    try {
      const t = await observeTolls(admin, orgId, {
        fetchVehicles: makeSamsaraVehiclesGpsFetcher(env, token),
        fetchTrailers: makeSamsaraTrailerGpsFetcher(env, token),
        listVehicles: makeSamsaraVehicleLister(env, token),
        listTrailers: makeSamsaraTrailerLister(env, token),
        nowMs: () => Date.now(),
      });
      if (t.observed + t.clock > 0) console.log(`[toll-gps] org ${orgId}: ${t.observed} tolls observed in ${t.windows} windows, ${t.clock} by clock; ${t.waiting} waiting`);
    } catch (e) {
      console.error(`[toll-gps] org ${orgId}: observation pass failed —`, e instanceof Error ? e.message : e);
    }
  }
}
