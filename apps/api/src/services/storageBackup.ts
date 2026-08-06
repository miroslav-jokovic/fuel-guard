import type { SupabaseClient } from "@supabase/supabase-js";
import { listAllObjects } from "./storageReconcile.js";

/**
 * Off-provider storage backup (§13.1, D13). Supabase database backups EXCLUDE Storage objects — the BOL
 * images a verdict rests on — so those must be copied to a SECOND provider on a schedule, or a DB restore
 * returns `hazmat_documents` rows pointing at files that no longer exist and the audit trail is provably
 * incomplete.
 *
 * Provider-agnostic by design: the caller supplies a `BackupTarget` implemented with whatever second
 * provider they run (S3 / Cloudflare R2 / Backblaze B2 / GCS). This file has zero cloud-SDK dependency,
 * so it typechecks + ships in the API; wiring the credentials + the schedule is the deployment step.
 */

export interface BackupTarget {
  /** Write an object to the second provider under `key` (e.g. `hazmat/<org>/<load>/<doc>.webp`). */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Optional: return true to skip an object already present + current (turns a full sync into an incremental one). */
  has?(key: string): Promise<boolean>;
}

export interface BackupResult {
  bucket: string;
  scanned: number;
  copied: number;
  skipped: number;
}

/** Copy every object in one Supabase bucket to the backup target, keyed `<bucket>/<path>`. */
export async function backupBucket(admin: SupabaseClient, bucket: string, target: BackupTarget): Promise<BackupResult> {
  const objects = await listAllObjects(admin, bucket);
  let copied = 0;
  let skipped = 0;
  for (const o of objects) {
    const key = `${bucket}/${o.path}`;
    if (target.has && (await target.has(key))) {
      skipped += 1;
      continue;
    }
    const { data, error } = await admin.storage.from(bucket).download(o.path);
    if (error || !data) throw new Error(error?.message ?? `download failed: ${o.path}`);
    const body = new Uint8Array(await data.arrayBuffer());
    await target.put(key, body, data.type || "application/octet-stream");
    copied += 1;
  }
  return { bucket, scanned: objects.length, copied, skipped };
}

/** Back up every evidence-bearing bucket (hazmat BOLs + driver load photos) to the second provider. */
export async function backupHazmatEvidence(admin: SupabaseClient, target: BackupTarget): Promise<BackupResult[]> {
  const buckets = ["hazmat", "load-photos"];
  const results: BackupResult[] = [];
  for (const bucket of buckets) results.push(await backupBucket(admin, bucket, target));
  return results;
}
