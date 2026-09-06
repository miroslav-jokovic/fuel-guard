import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { buildFuelSpendRollup } from "./fuelSpendRollup.js";
import { runFuelPolicyScanForWindow } from "./fuelPolicyScan.js";
import { resolveFuelTransactionStations } from "../fuel/index.js";

/**
 * Nightly rebuild of the daily fuel-spend rollup (migration 0244).
 *
 * ── WHY A TRAILING WINDOW AND NOT JUST YESTERDAY ─────────────────────────────────────────────────
 * Every input arrives late in its own way. The EFS feed posts a transaction days after the swipe;
 * Samsara engine days backfill; and an odometer interval is only measurable once the NEXT fill lands,
 * which for a truck on a long run can be a week later. Rebuilding only the previous day would freeze
 * each of those at whatever was known the morning after, and the numbers would drift permanently away
 * from the sources without anything reporting a problem. Two weeks is comfortably past all three.
 *
 * The rebuild is idempotent — it upserts every derived row and sweeps whatever it did not touch — so
 * re-deriving a fortnight nightly costs a few seconds and cannot double-count.
 *
 * It also resolves stations for fills that have none. A backfill alone would have gone stale within a
 * day — the EFS feed writes new fills continuously and none of them carry a station — so brand analysis
 * would have decayed from the moment it shipped. Stations are resolved BEFORE the rollup so a fill
 * bought today is already placed at a brand by the time anything reads it.
 *
 * Since C6 it also runs the POLICY SCAN, which files `fuel_exceptions` rows per truck × kind × month.
 * It rides here rather than in a scheduler of its own for two reasons: it needs the same fills the
 * rollup has just rebuilt and the stations resolved above it, and this repo's scheduler rule is that
 * every one of them must run in exactly one process fleet-wide — the cheapest way to honour that is not
 * to add another. Its window is this one, translated into whole calendar months; see
 * `fuelPolicyScan.ts` for why a month rather than the fortnight.
 *
 * Run in EXACTLY ONE process (see `startAllSchedulers`). This scheduler has no job-ledger guard, and
 * two processes rebuilding the same window would race each other's sweep: the loser's rows carry the
 * older timestamp and the winner deletes them.
 */
const DAILY_MS = 24 * 60 * 60 * 1000;
const REBUILD_DAYS = 14;

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

export function startFuelSpendRollupScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  let inFlight = false;
  const run = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const admin = getSupabaseAdmin(env);
      const { data, error } = await admin.from("organizations").select("id");
      if (error) throw new Error(error.message);

      const to = ymd(new Date());
      const from = ymd(new Date(Date.now() - REBUILD_DAYS * DAILY_MS));

      // Sequential and independently guarded: one carrier's bad odometer data must not stop the next
      // carrier's spend report from being rebuilt.
      for (const org of (data ?? []) as { id: string }[]) {
        try {
          // Cheap after the first run: only fills with no station are scanned.
          const st = await resolveFuelTransactionStations(admin, org.id);
          if (st.resolved > 0) {
            console.log(
              `[fuel-spend] org ${org.id}: ${st.resolved} of ${st.scanned} unplaced fill(s) resolved to a station` +
                (st.topUnmatched.length > 0 ? `; biggest gap ${st.topUnmatched[0]!.key} (${st.topUnmatched[0]!.fills} fills)` : ""),
            );
          }
          const r = await buildFuelSpendRollup(admin, org.id, from, to);
          if (r.written > 0 || r.deleted > 0) {
            console.log(
              `[fuel-spend] org ${org.id}: ${r.written} truck-day(s) written, ${r.deleted} swept, ` +
                `${r.rejectedIntervals} odometer interval(s) refused, ${r.unattributedFills} fill(s) with no truck` +
                (r.defUnmatched > 0 ? `, ${r.defUnmatched} DEF line(s) with no matching unit` : ""),
            );
          }

          /*
           * The policy scan rides the same sweep (C6). It runs AFTER the rollup and after station
           * resolution, in that order and not by accident: `policyFindings` groups by brand and by
           * state, and a fill whose station has not been resolved yet carries a null brand — which
           * `analyzePolicyExceptions` counts as off-network, correctly but prematurely. Scanning
           * first would file a finding against a truck for a Pilot fill nobody had placed yet, and
           * close it again the following night.
           *
           * Its window is the same trailing fortnight, translated into the calendar months it
           * touches, because a month is the unit its baseline is measured over. See the scan's header.
           */
          for (const scan of await runFuelPolicyScanForWindow(admin, org.id, from, to)) {
            if (scan.error) {
              console.error(`[fuel-spend] org ${org.id}: policy scan ${scan.month} failed: ${scan.error}`);
            } else if (scan.filed > 0 || scan.closed > 0) {
              console.log(
                `[fuel-spend] org ${org.id}: policy ${scan.month} — ${scan.filed} finding(s) ` +
                  `(${scan.inserted} new, ${scan.refreshed} refreshed, ${scan.closed} closed)`,
              );
            }
          }
        } catch (e) {
          console.error(`[fuel-spend] org ${org.id} rollup failed:`, e instanceof Error ? e.message : e);
        }
      }
    } catch (e) {
      console.error("[fuel-spend] rollup sweep failed:", e instanceof Error ? e.message : e);
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => void run(), DAILY_MS);
  timer.unref?.();
  // Deliberately NOT run on boot: a fortnight across every org is heavy, and a deploy loop would run it
  // on every restart. The first rebuild is one interval in; a backfill is an explicit API call.
}
