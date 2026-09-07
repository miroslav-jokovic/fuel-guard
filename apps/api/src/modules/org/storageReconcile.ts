import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Storage hygiene — orphan reconcile (§13.5). The `hazmat` bucket holds the BOL images a verdict was
 * based on; they must stay in lockstep with `hazmat_documents`. Two failure modes:
 *   - orphan OBJECT: an upload succeeded but the row insert failed → after a 24 h grace it is deleted.
 *   - orphan ROW (missing object): a row points at an object that is gone → FLAGGED, never dropped. This
 *     is also the D13 restore signal (a DB restore without the storage restore leaves rows dangling).
 *
 * The planner is pure + unit-tested; the service lists the live bucket and applies the plan.
 */

export interface StoredObject {
  path: string;
  createdAt: string;
}

export interface StorageReconcilePlan {
  /** Object paths with no DB row, older than the grace window — safe to delete. */
  orphanObjects: string[];
  /** DB row storage_paths whose object is missing — FLAG for alerting; never delete the row. */
  missingObjects: string[];
  scanned: number;
  rows: number;
}

/**
 * A path a row names but whose object may legitimately not exist yet (D-SCAN11).
 *
 * ── WHY THIS CATEGORY HAD TO EXIST ─────────────────────────────────────────────────────────────
 * Every path this reconciler knew about used to be written before or with its row, so "a row names
 * it and it is not there" could only mean the object was lost. The hazmat ORIGINAL of record breaks
 * that: it is recorded at registration and uploaded when the driver reaches an unmetered connection,
 * which may be days later. Without this category the nightly pass would do two wrong things at once
 * — flag every pending original as possible evidence loss, and, because `orphanObjects` deletes any
 * object no row path covers, delete the original 24 hours after it finally landed.
 *
 * `since` is the row's `created_at`, and it is what stops "pending" meaning "never flagged". A
 * deferred upload that has not happened after `PENDING_UPLOAD_GRACE_MS` is reported like any other
 * missing object.
 */
export interface DeferredPath {
  path: string;
  /** ISO timestamp the row was created — when the wait started. */
  since: string;
}

/**
 * How long a deferred upload may stay missing before it is reported.
 *
 * ⚠ **Thirty days is a chosen operational threshold, not a derived one**, and it is stated here
 * rather than left to look like a measurement. It gates a log line and nothing else — never a
 * deletion — and the only claim behind it is that a driver who has not reached an unmetered
 * connection in a month is itself worth knowing about. The exact answer would need the row to record
 * WHEN the upload happened, and it cannot: `hazmat_documents` is insert-only evidence with no UPDATE
 * policy, so there is nowhere to write `original_uploaded_at` without breaking the property the
 * table exists to have.
 */
const PENDING_UPLOAD_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Pure: compare live objects against the DB row paths and split into deletable orphans + missing
 * objects. `deferred` paths protect their objects from deletion always, and are reported missing
 * only once they are past `PENDING_UPLOAD_GRACE_MS`.
 */
export function planStorageReconcile(
  objects: readonly StoredObject[],
  rowPaths: readonly string[],
  nowIso: string,
  olderThanMs: number,
  deferred: readonly DeferredPath[] = [],
): StorageReconcilePlan {
  const rowSet = new Set(rowPaths);
  for (const d of deferred) rowSet.add(d.path); // a pending upload's object is NOT an orphan
  const objSet = new Set(objects.map((o) => o.path));
  const now = Date.parse(nowIso);
  const orphanObjects = objects
    .filter((o) => !rowSet.has(o.path) && now - Date.parse(o.createdAt) > olderThanMs)
    .map((o) => o.path);
  const missingObjects = [
    ...rowPaths.filter((p) => !objSet.has(p)),
    ...deferred
      .filter((d) => !objSet.has(d.path) && now - Date.parse(d.since) > PENDING_UPLOAD_GRACE_MS)
      .map((d) => d.path),
  ];
  return { orphanObjects, missingObjects, scanned: objects.length, rows: rowPaths.length + deferred.length };
}

interface RawListItem {
  name: string;
  id?: string | null;
  created_at?: string | null;
}

/** Recursively list every FILE in a bucket (folders have a null id in the Supabase list response). */
export async function listAllObjects(admin: SupabaseClient, bucket: string, prefix = "", acc: StoredObject[] = []): Promise<StoredObject[]> {
  const pageSize = 100;
  let offset = 0;
  for (;;) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: pageSize, offset });
    if (error) throw new Error(error.message);
    const items = (data ?? []) as RawListItem[];
    for (const it of items) {
      const full = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null || it.id === undefined) {
        await listAllObjects(admin, bucket, full, acc); // folder → descend
      } else {
        acc.push({ path: full, createdAt: it.created_at ?? new Date(0).toISOString() });
      }
    }
    if (items.length < pageSize) break;
    offset += pageSize;
  }
  return acc;
}

const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export interface StorageReconcileResult extends StorageReconcilePlan {
  deleted: number;
}

/**
 * Reconcile one evidence bucket against the table that indexes it. Deletes orphan objects past the
 * 24 h grace (when `apply`), and loudly flags rows whose object is missing — never deletes a row,
 * because a row is the claim that evidence exists and losing the claim silently is worse than losing
 * the bytes.
 *
 * Generalised from the hazmat-only version (LD3). `load-photos` holds a driver's proof of work at every
 * stop and had no reconciler at all: nothing checked that a photo dispatch can see a row for actually
 * exists in Storage. That is the failure mode where the database says the bill of lading was
 * photographed and the object behind it is gone.
 */
export async function reconcileBucketOrphans(
  admin: SupabaseClient,
  source: { bucket: string; table: string; label: string; deferredColumn?: string },
  opts: { apply?: boolean; nowIso?: string } = {},
): Promise<StorageReconcileResult> {
  // `deferredColumn` names a SECOND path column on the same row whose object may not exist yet. It
  // is selected alongside `created_at` because a deferral has to be able to expire — see DeferredPath.
  const columns = source.deferredColumn ? `storage_path, created_at, ${source.deferredColumn}` : "storage_path";
  const { data, error } = await admin.from(source.table).select(columns);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Array<Record<string, string | null>>;
  const rowPaths = rows.map((r) => r.storage_path as string);
  const deferred: DeferredPath[] = source.deferredColumn
    ? rows.flatMap((r) => {
        const path = r[source.deferredColumn as string];
        // Null is the ordinary case, not a fault: a manager-registered document has no original, and
        // so does every row written before Phase 4b.
        return path ? [{ path, since: r.created_at ?? new Date(0).toISOString() }] : [];
      })
    : [];

  const objects = await listAllObjects(admin, source.bucket);
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const plan = planStorageReconcile(objects, rowPaths, nowIso, ORPHAN_GRACE_MS, deferred);

  let deleted = 0;
  if (opts.apply && plan.orphanObjects.length > 0) {
    for (let i = 0; i < plan.orphanObjects.length; i += 100) {
      const batch = plan.orphanObjects.slice(i, i + 100);
      const { error: delErr } = await admin.storage.from(source.bucket).remove(batch);
      if (delErr) throw new Error(delErr.message);
      deleted += batch.length;
    }
  }

  if (plan.missingObjects.length > 0) {
    const sample = plan.missingObjects.slice(0, 5).join(", ");
    console.warn(
      `[storage] ${plan.missingObjects.length} ${source.label} row(s) point at a MISSING object ` +
        `(possible evidence loss / restore gap — D13): ${sample}${plan.missingObjects.length > 5 ? " …" : ""}`,
    );
  }

  return { ...plan, deleted };
}

/**
 * The BOL images a hazmat verdict was based on.
 *
 * ⚠ **Two paths per row since Phase 4b**, and this sweep is why that had to be said out loud.
 * `storage_path` is the ARCHIVE — uploaded immediately, downloaded by extraction, and required to
 * exist. `original_storage_path` (0327) is the untouched ORIGINAL of record, which D-SCAN11 defers
 * until the driver reaches an unmetered connection. Before this argument existed the sweep selected
 * `storage_path` alone, which meant an original was an object no row pointed at — and this function
 * runs nightly with `apply: true`, deleting exactly those, 24 hours after the grace window. The
 * evidence would have had a one-day life and nothing would have reported it.
 */
export function reconcileHazmatStorageOrphans(
  admin: SupabaseClient,
  opts: { apply?: boolean; nowIso?: string } = {},
): Promise<StorageReconcileResult> {
  return reconcileBucketOrphans(
    admin,
    { bucket: "hazmat", table: "hazmat_documents", label: "hazmat_documents", deferredColumn: "original_storage_path" },
    opts,
  );
}

/**
 * The applicant's STAGED photographs (A8) — the first bucket here that is not an evidence store.
 *
 * The asymmetry that makes this reconciler safe for a compliance bucket is what makes it valuable
 * here, running in the other direction. `application_captures` rows are written only AFTER the object
 * is provably in the bucket (`applicationCapture.ts`), so orphan objects are the NORMAL failure —
 * every browser upload that finished but whose confirm never arrived, and every superseded re-shoot
 * whose removal failed. Without this sweep a driver's four attempts at one licence photograph would
 * be billed indefinitely with nothing pointing at them.
 *
 * A missing object under a live row is still worth the warning it gets, and means something specific
 * here: a staged capture the driver was told was received is gone before the submission that would
 * have filed it.
 */
export function reconcileApplicationCaptureOrphans(
  admin: SupabaseClient,
  opts: { apply?: boolean; nowIso?: string } = {},
): Promise<StorageReconcileResult> {
  return reconcileBucketOrphans(
    admin,
    { bucket: "application-captures", table: "application_captures", label: "application_captures" },
    opts,
  );
}

/** A driver's proof of work at each stop — the same evidence guarantee, previously unreconciled. */
export function reconcileLoadPhotoOrphans(
  admin: SupabaseClient,
  opts: { apply?: boolean; nowIso?: string } = {},
): Promise<StorageReconcileResult> {
  return reconcileBucketOrphans(admin, { bucket: "load-photos", table: "load_stop_photos", label: "load_stop_photos" }, opts);
}

/**
 * The scans behind the driver qualification file (DQF execution plan B7).
 *
 * THE LEAK THIS CLOSES. `compliance-docs` (0146) shipped with the same register → signed-upload →
 * signed-read pipeline as `hazmat`, but was never added here — so for every registration whose
 * browser-side PUT then failed, and every upload whose row insert lost the race, the bytes stayed in
 * the bucket and were billed forever with nothing pointing at them and nothing looking. Two buckets
 * were swept and the third, which holds the most sensitive evidence in the product, was not.
 *
 * SAFE BECAUSE THE ASYMMETRY IS ALREADY BUILT. `reconcileBucketOrphans` deletes only objects that no
 * row references and that are past the 24-hour grace, and it NEVER deletes a row — a `documents` row
 * whose object has vanished is flagged loudly instead, which is exactly the §391.51 signal worth
 * waking someone for. That asymmetry is what makes this safe to point at a compliance bucket:
 * the failure mode it can cause is "we kept bytes we could have deleted", never "we deleted
 * evidence".
 *
 * DERIVATIVES NEED NO SPECIAL CASE. A thumb or a normalized render is its own `documents` row with
 * its own `storage_path` (plan B1/B2), so it appears in the same `select storage_path` this reads.
 * A derivative whose row is gone is an orphan like any other.
 */
export function reconcileComplianceDocOrphans(
  admin: SupabaseClient,
  opts: { apply?: boolean; nowIso?: string } = {},
): Promise<StorageReconcileResult> {
  return reconcileBucketOrphans(admin, { bucket: "compliance-docs", table: "documents", label: "documents" }, opts);
}
