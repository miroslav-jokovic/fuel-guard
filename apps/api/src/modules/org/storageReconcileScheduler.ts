import { localHourMinute } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import {
  reconcileApplicationCaptureOrphans,
  reconcileComplianceDocOrphans,
  reconcileHazmatStorageOrphans,
  reconcileLoadPhotoOrphans,
} from "./storageReconcile.js";

/**
 * Nightly evidence-storage reconcile (§13.5 / M11). Deletes objects with no indexing row past the 24 h
 * grace, and flags rows whose object is missing (the D13 restore signal). Mirrors the other schedulers'
 * shape: interval + in-flight guard, env-gated, failures logged, never crashes the process. Run in
 * EXACTLY ONE process (see startAllSchedulers).
 *
 * Covers EVERY evidence bucket. `load-photos` — a driver's proof of work at every stop — had no
 * reconciler at all until LD3: nothing checked that a photo the office can see a row for still exists,
 * which is precisely the state that makes a dispatch screen show a broken image and nobody find out.
 * `compliance-docs` (0146) was in the same state until the DQF execution plan's step B7 and had been
 * since it shipped: every failed upload's bytes billed indefinitely with no row pointing at them.
 *
 * Named for what it does. It was `hazmatStorageReconcileScheduler` when it swept one bucket; it has
 * swept two since LD3, three since B7 and four since A8, and a name that says "hazmat" on the file
 * that also decides the fate of every driver's medical-card scan is a name that misleads the next
 * reader.
 *
 * ⚠ `application-captures` (A8) is the one bucket here that is NOT an evidence store, and it is swept
 * for the opposite reason: staged photographs are registered only after the bytes land, so orphan
 * objects are the routine failure rather than the alarming one. Without this pass a driver's
 * abandoned re-shoots would be billed for ever.
 */
/**
 * Once a night at a fixed Central-time hour, not once per 24 h of process life.
 *
 * It was `setInterval(run, 24h)` with no boot run. Measured 2026-10-02, the api process restarted
 * 810 times in 40 days (median life 23 minutes) and lived 24 h exactly once, so this reconciler had
 * effectively never run — the "nightly orphan sweep" that dataRetentionPolicy.ts leans on twice was
 * a promise with no clock behind it. A nightly release (RELEASE-TRAIN-PLAN) would not have fixed
 * it: a 24 h interval started at the 01:00 release first fires at the NEXT release, which kills it.
 *
 * 06:00 Central sits after everything heavy in the night (the 01:00 release, the 02:55 EFS session
 * reset, the 03:00 nightly reconcile that has run up to 154 minutes) and before the office's first
 * action, measured at 07:00. The ledger-less "already ran today" key lives in memory: two processes
 * both crossing 06:00 the same day would need a restart inside that hour, and a second pass is a
 * no-op because the reconcile is idempotent.
 */
export const STORAGE_RECONCILE_HOUR = 6;
export const STORAGE_RECONCILE_TZ = "America/Chicago";
const TICK_MS = 15 * 60_000;

/** The Central calendar day to stamp when a reconcile is due now, or null when it is not. Pure. */
export function storageReconcileDueDay(nowMs: number, lastRanDay: string | null): string | null {
  const now = new Date(nowMs);
  if (localHourMinute(now.toISOString(), STORAGE_RECONCILE_TZ).h !== STORAGE_RECONCILE_HOUR) return null;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: STORAGE_RECONCILE_TZ }).format(now);
  return day === lastRanDay ? null : day;
}

export function startStorageReconcileScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  let inFlight = false;
  const run = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    const admin = getSupabaseAdmin(env);
    // Sequential, and one failure must not skip the other bucket: they are independent evidence stores.
    for (const [label, reconcile] of [
      ["hazmat", reconcileHazmatStorageOrphans],
      ["load-photos", reconcileLoadPhotoOrphans],
      ["compliance-docs", reconcileComplianceDocOrphans],
      ["application-captures", reconcileApplicationCaptureOrphans],
    ] as const) {
      try {
        const r = await reconcile(admin, { apply: true });
        if (r.deleted > 0 || r.missingObjects.length > 0) {
          console.log(
            `[storage] ${label} reconcile: scanned ${r.scanned} object(s), deleted ${r.deleted} orphan(s), ` +
              `flagged ${r.missingObjects.length} missing`,
          );
        }
      } catch (e) {
        console.error(`[storage] ${label} reconcile failed:`, e instanceof Error ? e.message : e);
      }
    }
    inFlight = false;
  };

  // Still never on boot — a full-bucket listing is heavy, and the release that booted us is 01:00.
  let lastRanDay: string | null = null;
  const timer = setInterval(() => {
    const due = storageReconcileDueDay(Date.now(), lastRanDay);
    if (!due) return;
    lastRanDay = due;
    void run();
  }, TICK_MS);
  timer.unref?.();
}
