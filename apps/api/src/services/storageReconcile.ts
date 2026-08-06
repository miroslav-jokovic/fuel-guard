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
 * Reconcile the `hazmat` bucket against `hazmat_documents`. Deletes orphan objects past the 24 h grace
 * (when `apply`), and loudly flags rows whose object is missing (never deletes a row — that is evidence).
 */
export async function reconcileHazmatStorageOrphans(
  admin: SupabaseClient,
  opts: { apply?: boolean; nowIso?: string } = {},
): Promise<StorageReconcileResult> {
  const { data, error } = await admin.from("hazmat_documents").select("storage_path");
  if (error) throw new Error(error.message);
  const rowPaths = (data ?? []).map((r) => (r as { storage_path: string }).storage_path);

  const objects = await listAllObjects(admin, "hazmat");
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const plan = planStorageReconcile(objects, rowPaths, nowIso, ORPHAN_GRACE_MS);

  let deleted = 0;
  if (opts.apply && plan.orphanObjects.length > 0) {
    for (let i = 0; i < plan.orphanObjects.length; i += 100) {
      const batch = plan.orphanObjects.slice(i, i + 100);
      const { error: delErr } = await admin.storage.from("hazmat").remove(batch);
      if (delErr) throw new Error(delErr.message);
      deleted += batch.length;
    }
  }

  if (plan.missingObjects.length > 0) {
    const sample = plan.missingObjects.slice(0, 5).join(", ");
    console.warn(
      `[storage] ${plan.missingObjects.length} hazmat_documents row(s) point at a MISSING object ` +
        `(possible evidence loss / restore gap — D13): ${sample}${plan.missingObjects.length > 5 ? " …" : ""}`,
    );
  }

  return { ...plan, deleted };
}
