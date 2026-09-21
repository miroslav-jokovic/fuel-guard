import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { buildFuelSpendRollup } from "./fuelSpendRollup.js";
import { runFuelPolicyScanForWindow } from "./fuelPolicyScan.js";
import { resolveFuelTransactionStations } from "../fuel/index.js";
import { markFuelSweepComplete, startJob, startJobHeartbeat, finishJob, JobConflictError } from "../org/index.js";
import { runFuelSweepFreshnessOnce, FUEL_SWEEP_JOB_KIND } from "./fuelSweepFreshness.js";
import { BOOT_DELAY_MS, CHECK_INTERVAL_MS, REBUILD_DAYS, SWEEP_DUE_AFTER_MS } from "./fuelSweepCadence.js";

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
 * Run in EXACTLY ONE process (see `startAllSchedulers`) — two processes rebuilding the same window
 * would race each other's sweep, the loser's rows carrying the older timestamp and the winner
 * deleting them. Since 2026-09-21 that is no longer a convention held by deployment alone: each
 * org's sweep claims the (org, `fuel_spend_rollup`) slot in the job ledger, so a second process is
 * refused by the database. See `sweepThroughLedger`.
 *
 * ── ⚠ AND WHY IT IS NOT A BARE 24-HOUR INTERVAL ANY MORE (0324) ─────────────────────────────────
 * It was `setInterval(run, 24h)` with a deliberate "NOT run on boot", whose reasoning was sound in
 * isolation: a fortnight across every org is heavy, and a deploy loop would run it on every restart.
 * What it did not survive is how often this service deploys. Measured 2026-09-06, `main` took between
 * 8 and 42 merges a day over the preceding ten days, and every merge restarts the API and resets the
 * timer — so a 24-hour interval on a process that rarely lives 24 hours fired approximately never.
 *
 * The cost was not theoretical. C6 shipped the policy scan on 2026-09-05 and it rides this sweep;
 * `fuel_exceptions` still held ONE row and zero policy findings, against a configured policy and
 * ~14,800 fills to scan, and `fuel_spend_days`' newest derivation predated C6 entirely.
 *
 * So it now checks OFTEN and works RARELY, deduped on a persisted per-org marker: the shape
 * `digestScheduler.ts` already uses, whose own comment says `last_digest_at` exists "so restarts
 * don't double-send". A restart now re-CHECKS instead of re-running, and — the half the old design
 * got wrong in the other direction — a gap longer than a day is noticed instead of being skipped.
 */
const DAILY_MS = 24 * 60 * 60 * 1000;

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Whether this org's sweep is due.
 *
 * ⚠ NULL means NEVER SWEPT and is therefore due — which is every org on the day 0324 ships, and is
 * the condition that makes the first run happen at all. Reading a missing marker as "recent" would
 * have shipped a fix that changed nothing.
 */
export function isFuelSweepDue(lastSweptAt: string | null | undefined, now: Date): boolean {
  if (!lastSweptAt) return true;
  const last = new Date(lastSweptAt).getTime();
  // An unparseable stamp is treated as never swept rather than as a reason to stop sweeping.
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= SWEEP_DUE_AFTER_MS;
}

/**
 * One org's sweep: stations, then the rollup, then the policy scan. Extracted from the loop so the
 * ledger can wrap it (below) without the loop growing another level of indentation — and so the
 * order of the three, which is load-bearing, is readable in one screen.
 */
async function sweepOneOrg(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<Record<string, unknown>> {
  // Cheap after the first run: only fills with no station are scanned.
  const st = await resolveFuelTransactionStations(admin, orgId);
  if (st.resolved > 0) {
    console.log(
      `[fuel-spend] org ${orgId}: ${st.resolved} of ${st.scanned} unplaced fill(s) resolved to a station` +
        (st.topUnmatched.length > 0 ? `; biggest gap ${st.topUnmatched[0]!.key} (${st.topUnmatched[0]!.fills} fills)` : ""),
    );
  }
  const r = await buildFuelSpendRollup(admin, orgId, from, to);
  if (r.written > 0 || r.deleted > 0) {
    console.log(
      `[fuel-spend] org ${orgId}: ${r.written} truck-day(s) written, ${r.deleted} swept, ` +
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
  let scansFailed = 0;
  for (const scan of await runFuelPolicyScanForWindow(admin, orgId, from, to)) {
    if (scan.error) {
      scansFailed += 1;
      console.error(`[fuel-spend] org ${orgId}: policy scan ${scan.month} failed: ${scan.error}`);
    } else if (scan.filed > 0 || scan.closed > 0) {
      console.log(
        `[fuel-spend] org ${orgId}: policy ${scan.month} — ${scan.filed} finding(s) ` +
          `(${scan.inserted} new, ${scan.refreshed} refreshed, ${scan.closed} closed)`,
      );
    }
  }

  return { stationsResolved: st.resolved, written: r.written, deleted: r.deleted, rejectedIntervals: r.rejectedIntervals, unattributedFills: r.unattributedFills, scansFailed };
}

/**
 * Run one org's sweep THROUGH the job ledger. Returns whether it completed.
 *
 * ── WHY THE LEDGER, AS OF 2026-09-21 (queue item 3 of DATA-PRECISION-AUDIT-2026-09-20.md) ──────
 * The `catch` below used to be the entire failure story: one `console.error` line, and a scheduler
 * that went on failing every six hours for seven days while `last_fuel_sweep_at` sat still. The
 * ledger is what turns that into something a human can find without grepping Railway — an `error`
 * column, a `finished_at`, a row `GET /api/org/jobs/failed` returns, and the input
 * `fuelSweepFreshness.ts` reads to raise a finding. ⚠ No PAGE renders that endpoint as of
 * 2026-09-21, which is why the finding, not the row, is the deliverable of queue item 3; a Data &
 * sync card for this kind is recorded in the plan as the follow-up it is.
 *
 * It also closes the hole this file's own header admits to: "This scheduler has no job-ledger guard,
 * and two processes rebuilding the same window would race each other's sweep." `startJob` claims the
 * (org, kind) slot, so a second process is now REFUSED by the database rather than trusted not to
 * exist. A conflict is a skip, not a failure — the other holder is doing the work.
 *
 * ⚠ A ledger that cannot be written must not stop the rebuild. Observability that gates the work it
 * observes has converted a reporting outage into a data outage, which is strictly worse than the
 * silence it was added to fix — so a non-conflict `startJob` error is logged and the sweep proceeds
 * with no job row.
 */
async function sweepThroughLedger(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
  now: Date,
): Promise<boolean> {
  let jobId: string | null = null;
  try {
    jobId = await startJob(admin, orgId, FUEL_SWEEP_JOB_KIND);
  } catch (e) {
    if (e instanceof JobConflictError) {
      console.log(`[fuel-spend] org ${orgId}: a rebuild is already running; skipping this check`);
      return false;
    }
    console.error(`[fuel-spend] org ${orgId}: could not open a job row, sweeping unledgered:`, e instanceof Error ? e.message : e);
  }
  const stopHeartbeat = jobId ? startJobHeartbeat(admin, jobId) : null;
  try {
    const stats = await sweepOneOrg(admin, orgId, from, to);
    /*
     * Stamped only after the org's sweep completes without throwing, so a failure retries at the
     * next check instead of being marked done. A policy scan that reports `scan.error` does NOT
     * throw and does not block the stamp: it is logged, counted into `stats.scansFailed`, and a
     * month that fails persistently would otherwise re-run the whole fortnight every six hours.
     */
    await markFuelSweepComplete(admin, orgId, now);
    if (jobId) await finishJob(admin, jobId, { status: "done", stats });
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[fuel-spend] org ${orgId} rollup failed:`, message);
    if (jobId) await finishJob(admin, jobId, { status: "failed", error: message });
    return false;
  } finally {
    stopHeartbeat?.();
  }
}

/**
 * Sweep every org whose turn it is, then say so when one of them has stopped being swept. Exported
 * so the due logic is testable without a timer.
 *
 * The freshness pass runs for EVERY org on EVERY check, not only the ones swept: an org whose sweep
 * keeps failing is never "due" again in any useful sense — it is due every time and completes none
 * of them — and that is precisely the org the pass exists for.
 */
export async function runDueFuelSweeps(admin: SupabaseClient, env: Env, now: Date = new Date()): Promise<void> {
  const { data, error } = await admin.from("organizations").select("id, last_fuel_sweep_at, created_at");
  if (error) throw new Error(error.message);

  const to = ymd(now);
  const from = ymd(new Date(now.getTime() - REBUILD_DAYS * DAILY_MS));

  // Sequential and independently guarded: one carrier's bad odometer data must not stop the next
  // carrier's spend report from being rebuilt.
  for (const org of (data ?? []) as { id: string; last_fuel_sweep_at: string | null; created_at: string | null }[]) {
    let lastSweptAt = org.last_fuel_sweep_at;
    if (isFuelSweepDue(lastSweptAt, now) && (await sweepThroughLedger(admin, org.id, from, to, now))) {
      lastSweptAt = now.toISOString();
    }

    // In its own try: a notification that cannot be sent must not stop the next carrier's rebuild.
    try {
      const fresh = await runFuelSweepFreshnessOnce(
        admin,
        env,
        org.id,
        { lastSweptAt, orgCreatedAt: org.created_at },
        now,
      );
      if (fresh.length) {
        console.log(`[fuel-freshness] org ${org.id}: ${fresh.length} new finding(s) — ${fresh.map((f) => f.title).join("; ")}`);
      }
    } catch (e) {
      console.error(`[fuel-freshness] org ${org.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
}

export function startFuelSpendRollupScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  let inFlight = false;
  const run = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      await runDueFuelSweeps(getSupabaseAdmin(env), env);
    } catch (e) {
      console.error("[fuel-spend] rollup sweep failed:", e instanceof Error ? e.message : e);
    } finally {
      inFlight = false;
    }
  };

  // Checks on boot and every six hours; each check sweeps only the orgs whose marker is stale, so a
  // redeploy costs one cheap read per org rather than a rebuild. This is what replaced a 24-hour
  // interval that a redeploy reset before it ever fired.
  const boot = setTimeout(() => void run(), BOOT_DELAY_MS);
  boot.unref?.();
  const timer = setInterval(() => void run(), CHECK_INTERVAL_MS);
  timer.unref?.();
}
