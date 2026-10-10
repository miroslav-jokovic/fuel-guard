/**
 * Records the dispatch board's ETA as it is made, so DB7 can score it against the arrival
 * (DISPATCH-BOARD-PLAN DB7, Q-DB4; table 0453, owned by `loads`).
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────────────────────────
 * Q-DB4 ruled the distance ETA ships first and is measured against actual arrivals for two weeks
 * before HERE's matrix is bought. On 2026-10-10 there was nothing to measure: `boardEta` runs on each
 * board read and its inputs (position, HOS clocks) are current state, overwritten minutes later. So the
 * board's own composition is sampled here, hourly, and its estimate for each truck's next stop kept.
 *
 * ── THE SAME ESTIMATE A DISPATCHER SAW ───────────────────────────────────────────────────────────
 * `readBoardRows` is the board's composition, unchanged — not a second ETA computation that could drift
 * from the one on screen. The scope and links half of the board is per caller and is not read here.
 *
 * ── LIGHT, AND ONE PROCESS ───────────────────────────────────────────────────────────────────────
 * Four org-scoped reads and one insert of ~120 rows an hour; no vendor call, no per-row work beyond the
 * board's own. Started from `startAllSchedulers`, so it runs wherever the schedulers run and nowhere
 * else (`docs/WORKER-DEPLOYMENT.md`). No jobs-ledger row: the freshness signal is the table's own
 * `predicted_at`, the clocks tier's reasoning. `DISPATCH_BOARD_ETA_RECORD_MINUTES=0` turns it off.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { recordStopEtaPredictions, type StopEtaPrediction } from "../loads/index.js";
import { readBoardRows } from "./dispatchBoard.js";

/** After boot, long enough for the clocks tier's first poll (five minutes) to have landed. */
const BOOT_DELAY_MS = 6 * 60_000;

/** One org's recording: a row per truck heading to a stop the board could estimate. Returns the count. */
export async function recordBoardEtas(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<number> {
  const { rows } = await readBoardRows(admin, orgId, now);
  const predictions: StopEtaPrediction[] = [];
  for (const r of rows) {
    const stop = r.current?.nextStop;
    // No ETA (no fix, no stop coordinates, already arrived) or no seq to join an arrival on: nothing to score.
    if (!r.current || !stop || stop.seq == null || !r.eta) continue;
    predictions.push({
      loadId: r.current.loadId,
      stopSeq: stop.seq,
      vehicleId: r.vehicleId,
      etaAt: r.eta.at,
      miles: r.eta.miles,
      restAdded: r.eta.restAdded,
      gpsAgeSeconds: r.position?.ageSeconds ?? null,
      hosKnown: r.hos != null,
      windowClosesAt: stop.appointmentEnd ?? stop.appointmentStart,
      verdict: r.onTime,
    });
  }
  if (!predictions.length) return 0;
  return recordStopEtaPredictions(admin, orgId, now, predictions);
}

export function startBoardEtaRecorder(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  if (env.DISPATCH_BOARD_ETA_RECORD_MINUTES <= 0) return;

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
          await recordBoardEtas(admin, id);
        } catch (e) {
          console.error(`[board-eta] recording failed for org ${id}:`, e instanceof Error ? e.message : e);
        }
      }
    } catch (e) {
      console.error("[board-eta] run failed:", e instanceof Error ? e.message : e);
    } finally {
      inFlight = false;
    }
  };

  const boot = setTimeout(() => void run(), BOOT_DELAY_MS);
  boot.unref?.();
  const timer = setInterval(() => void run(), env.DISPATCH_BOARD_ETA_RECORD_MINUTES * 60_000);
  timer.unref?.();
}
