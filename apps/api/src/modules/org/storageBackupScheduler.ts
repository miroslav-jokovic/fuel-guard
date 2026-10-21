import { localHourMinute } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { latestJob, lastDoneJob, runJob } from "./jobs.js";
import { backupOrgStorage } from "./storageBackup.js";
import { storageBackupTarget } from "./storageBackupS3.js";

/**
 * Nightly off-provider copy of every evidence bucket (storageBackup.ts), one ledger job per org.
 *
 * Checks often and works rarely, deduped on the LEDGER, not on process memory — the lesson both
 * `storageReconcileScheduler.ts` and `fuelSpendRollupScheduler.ts` record: this api restarted 810 times
 * in 40 days (median life 23 minutes), so anything keyed on "24 h since this process started" fires
 * approximately never. The last `done` row survives restarts; an in-memory stamp does not.
 *
 * 04:00 Central: after the 01:00 release and the 03:00 nightly reconcile have started, and BEFORE the
 * 06:00 orphan sweep deletes failed uploads — so a file that is about to be judged an orphan is copied
 * first. Whether it should have been is the sweep's question; the backup keeps the bytes either way.
 */
export const STORAGE_BACKUP_HOUR = 4;
export const STORAGE_BACKUP_TZ = "America/Chicago";
const TICK_MS = 15 * 60_000;
/** A missed night (deploys all through 04:00, an outage) is caught up at any hour once this much has passed. */
export const CATCH_UP_AFTER_MS = 30 * 3_600_000;
/** A failed run is retried no sooner than this, so a broken credential is one row an hour, not four. */
export const RETRY_AFTER_MS = 3_600_000;

const centralDay = (ms: number): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: STORAGE_BACKUP_TZ }).format(new Date(ms));

/**
 * Pure: is this org's copy due now?
 *
 * ⚠ No success ever means DUE, at any hour — that is the first run, on the deploy that ships this,
 * and the 1.3 GB nobody has a second copy of should not wait for 04:00.
 */
export function isStorageBackupDue(
  nowMs: number,
  lastDoneAtMs: number | null,
  lastFailedAtMs: number | null,
): boolean {
  if (lastFailedAtMs !== null && nowMs - lastFailedAtMs < RETRY_AFTER_MS) return false;
  if (lastDoneAtMs === null) return true;
  if (nowMs - lastDoneAtMs >= CATCH_UP_AFTER_MS) return true;
  const hour = localHourMinute(new Date(nowMs).toISOString(), STORAGE_BACKUP_TZ).h;
  return hour === STORAGE_BACKUP_HOUR && centralDay(lastDoneAtMs) !== centralDay(nowMs);
}

const stampMs = (iso: string | null | undefined): number | null => {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
};

export function startStorageBackupScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const target = storageBackupTarget(env);
  if (!target) {
    console.log("[storage-backup] off: STORAGE_BACKUP_* variables not set");
    return;
  }
  const admin = getSupabaseAdmin(env);

  const tick = async (): Promise<void> => {
    const { data: orgs, error } = await admin.from("organizations").select("id");
    if (error) throw new Error(error.message);
    const now = Date.now();
    for (const { id: orgId } of (orgs ?? []) as { id: string }[]) {
      const [done, latest] = await Promise.all([
        lastDoneJob(admin, orgId, "storage_backup"),
        latestJob(admin, orgId, "storage_backup"),
      ]);
      const failedAt = latest?.status === "failed" ? stampMs(latest.finished_at) : null;
      if (!isStorageBackupDue(now, stampMs(done?.finished_at), failedAt)) continue;
      // runJob returns once the slot is claimed; a run still going from the last tick is a conflict, skipped.
      await runJob(admin, orgId, "storage_backup", async (report) => {
        const r = await backupOrgStorage(admin, orgId, target, report);
        console.log(
          `[storage-backup] org ${orgId}: ${r.copied} of ${r.scanned} object(s) copied ` +
            `(${(r.bytes / 1e6).toFixed(1)} MB) across ${r.buckets} bucket(s)`,
        );
        return { ...r };
      });
    }
  };

  const run = (): void => {
    tick().catch((e) => console.error("[storage-backup] tick failed:", e instanceof Error ? e.message : e));
  };
  // First check a minute after boot, not at once: the boot itself is the busiest minute this process has.
  setTimeout(run, 60_000).unref?.();
  setInterval(run, TICK_MS).unref?.();
}
