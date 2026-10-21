import type { SupabaseClient } from "@supabase/supabase-js";
import { mapPool } from "../../lib/mapPool.js";
import { listAllObjects, type StoredObject } from "./storageReconcile.js";

/**
 * Off-provider storage backup (§13.1, D13). Supabase database backups EXCLUDE Storage objects — the BOL
 * images a verdict rests on, every driver's medical card, every roadside inspection photo — so those
 * must be copied to a SECOND provider on a schedule, or a DB restore returns rows pointing at files
 * that no longer exist and the audit trail is provably incomplete.
 *
 * ── WHY THIS WAS REWRITTEN ON 2026-10-21 ─────────────────────────────────────────────────────────
 * This file existed since the hazmat work and nothing called it (SECURITY-REVIEW-2026-09-06 item 19).
 * It also named its buckets by hand — `hazmat` and `load-photos` — and measured on production that day
 * both were EMPTY, while the 1.3 GB that was there sat in `compliance-docs`, `document-intake`,
 * `inspection-evidence` and `application-captures`, none of which it would have copied. A list of
 * evidence buckets written beside the buckets themselves went stale the first time a feature added
 * one. So the set is now DERIVED from `storage.listBuckets()`, minus the exclusions below, each with
 * its reason: a bucket created tomorrow is backed up tomorrow night without anybody remembering to.
 *
 * ── SHAPE ────────────────────────────────────────────────────────────────────────────────────────
 * Per org, because every object path in every bucket starts with the org id (measured 2026-10-21:
 * no exceptions) and because the job ledger is per org — a failed night is a `jobs` row an operator
 * can read, and the (org, `storage_backup`) slot stops two processes copying at once.
 *
 * Incremental. The target's inventory under `<bucket>/<org>/` is read once per bucket and compared to
 * the Supabase listing; only new or changed objects are downloaded. A night with no uploads costs a
 * listing on each side and nothing else.
 *
 * Copy-only, never mirror. An object deleted in Supabase stays in the backup — that is the point of
 * it — and the bucket's own versioning + Object Lock (governance, 90 days) keeps a replaced object's
 * previous bytes too. What the backup must eventually forget is an owner decision, not this file's.
 */

/** One object as the target holds it. */
export interface TargetObject {
  size: number;
  /** Epoch ms of the target's last write of this key. */
  lastModifiedMs: number;
}

export interface BackupTarget {
  /** Every object under `prefix`, keyed by full key. One call per bucket per org per night. */
  inventory(prefix: string): Promise<Map<string, TargetObject>>;
  /** Write one object. Overwrites create a new version; the bucket never loses the old one. */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

/**
 * Buckets deliberately NOT copied, with why. Everything else `listBuckets` returns is.
 *
 * `compliance-exports` holds finished audit binders: a DERIVED PII aggregate with a 7-day life
 * (D-BD4, `dqExportSweeper`). Its every page is a source document already copied from
 * `compliance-docs`, and a 90-day-locked copy would outlive by months the deletion that rule exists for.
 */
export const BACKUP_EXCLUDED_BUCKETS: ReadonlyMap<string, string> = new Map([
  ["compliance-exports", "derived audit binders with a 7-day life (D-BD4); their sources are copied"],
]);

/** Pure: the buckets to copy, from every bucket Storage has. Sorted so a run's log reads the same nightly. */
export function bucketsToBackUp(all: readonly string[]): string[] {
  return all.filter((b) => !BACKUP_EXCLUDED_BUCKETS.has(b)).sort();
}

/** The target key for one Supabase object. Bucket first, so one bucket's copy is one prefix. */
export function backupKey(bucket: string, path: string): string {
  return `${bucket}/${path}`;
}

/**
 * Pure: which listed objects the target does not have, or has an older or different copy of.
 *
 * Size OR time, not size alone: a document replaced in place by one of the same length (a re-scan at
 * the same resolution) would otherwise never be copied again. And not time alone: a listing that
 * reports no `updated_at` must still be copied once, not judged current because nothing is newer.
 */
export function objectsToCopy(
  bucket: string,
  objects: readonly StoredObject[],
  held: ReadonlyMap<string, TargetObject>,
): StoredObject[] {
  return objects.filter((o) => {
    const copy = held.get(backupKey(bucket, o.path));
    if (!copy) return true;
    if (o.size !== undefined && o.size !== copy.size) return true;
    const written = o.updatedAt ? Date.parse(o.updatedAt) : Number.NaN;
    return Number.isFinite(written) && written > copy.lastModifiedMs;
  });
}

export interface OrgBackupResult {
  buckets: number;
  scanned: number;
  copied: number;
  bytes: number;
  failed: number;
}

/** Downloads in flight at once. Most objects are tens of KB, so this is round trips, not bandwidth. */
const COPY_CONCURRENCY = 4;
/** Paths named in a failure message. The count is complete; the list is a starting point. */
const FAILURES_NAMED = 5;

/**
 * Copy one org's objects in every bucket. Throws AFTER trying every object when any failed, so the job
 * row reads `failed` with the count — one unreadable file must neither stop the rest of the night's
 * copy nor let the run report `done`.
 */
export async function backupOrgStorage(
  admin: SupabaseClient,
  orgId: string,
  target: BackupTarget,
  report?: (done: number, total?: number) => Promise<void>,
): Promise<OrgBackupResult> {
  const { data: bucketRows, error } = await admin.storage.listBuckets();
  if (error) throw new Error(`listBuckets: ${error.message}`);
  const buckets = bucketsToBackUp((bucketRows ?? []).map((b) => b.name));

  const result: OrgBackupResult = { buckets: buckets.length, scanned: 0, copied: 0, bytes: 0, failed: 0 };
  const failures: string[] = [];
  for (const bucket of buckets) {
    const objects = await listAllObjects(admin, bucket, orgId);
    const held = await target.inventory(backupKey(bucket, `${orgId}/`));
    const todo = objectsToCopy(bucket, objects, held);
    result.scanned += objects.length;
    await mapPool(todo, COPY_CONCURRENCY, async (o) => {
      try {
        const { data, error: dlError } = await admin.storage.from(bucket).download(o.path);
        if (dlError || !data) throw new Error(dlError?.message ?? "empty download");
        const body = new Uint8Array(await data.arrayBuffer());
        await target.put(backupKey(bucket, o.path), body, data.type || "application/octet-stream");
        result.copied += 1;
        result.bytes += body.byteLength;
      } catch (e) {
        result.failed += 1;
        failures.push(`${bucket}/${o.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    await report?.(result.copied);
  }
  if (result.failed > 0) {
    throw new Error(
      `${result.failed} of ${result.scanned} object(s) not copied (${result.copied} copied): ` +
        failures.slice(0, FAILURES_NAMED).join("; "),
    );
  }
  return result;
}
