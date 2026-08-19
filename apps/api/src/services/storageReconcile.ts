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

/** Pure: compare live objects against the DB row paths and split into deletable orphans + missing objects. */
export function planStorageReconcile(
  objects: readonly StoredObject[],
  rowPaths: readonly string[],
  nowIso: string,
  olderThanMs: number,
): StorageReconcilePlan {
  const rowSet = new Set(rowPaths);
  const objSet = new Set(objects.map((o) => o.path));
  const now = Date.parse(nowIso);
  const orphanObjects = objects
    .filter((o) => !rowSet.has(o.path) && now - Date.parse(o.createdAt) > olderThanMs)
    .map((o) => o.path);
  const missingObjects = rowPaths.filter((p) => !objSet.has(p));
  return { orphanObjects, missingObjects, scanned: objects.length, rows: rowPaths.length };
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
  source: { bucket: string; table: string; label: string },
  opts: { apply?: boolean; nowIso?: string } = {},
): Promise<StorageReconcileResult> {
  const { data, error } = await admin.from(source.table).select("storage_path");
  if (error) throw new Error(error.message);
  const rowPaths = (data ?? []).map((r) => (r as { storage_path: string }).storage_path);

  const objects = await listAllObjects(admin, source.bucket);
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const plan = planStorageReconcile(objects, rowPaths, nowIso, ORPHAN_GRACE_MS);

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

/** The BOL images a hazmat verdict was based on. */
export function reconcileHazmatStorageOrphans(
  admin: SupabaseClient,
  opts: { apply?: boolean; nowIso?: string } = {},
): Promise<StorageReconcileResult> {
  return reconcileBucketOrphans(admin, { bucket: "hazmat", table: "hazmat_documents", label: "hazmat_documents" }, opts);
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
