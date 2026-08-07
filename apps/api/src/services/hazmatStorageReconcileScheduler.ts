import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { reconcileHazmatStorageOrphans, reconcileLoadPhotoOrphans } from "./storageReconcile.js";

/**
 * Nightly evidence-storage reconcile (§13.5 / M11). Deletes objects with no indexing row past the 24 h
 * grace, and flags rows whose object is missing (the D13 restore signal). Mirrors the other schedulers'
 * shape: interval + in-flight guard, env-gated, failures logged, never crashes the process. Run in
 * EXACTLY ONE process (see startAllSchedulers).
 *
 * Covers BOTH evidence buckets. `load-photos` — a driver's proof of work at every stop — had no
 * reconciler at all until LD3: nothing checked that a photo the office can see a row for still exists,
 * which is precisely the state that makes a dispatch screen show a broken image and nobody find out.
 */
const DAILY_MS = 24 * 60 * 60 * 1000;

export function startHazmatStorageReconcileScheduler(env: Env): void {
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

  const timer = setInterval(() => void run(), DAILY_MS);
  timer.unref?.();
  // Deliberately NOT run on boot — a full-bucket listing is heavy; the first run is one interval in.
}
