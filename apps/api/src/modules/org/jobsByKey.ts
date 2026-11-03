import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobKind, JobRow } from "./jobs.js";

/**
 * The most-recent SUCCESSFUL job carrying one dedup key — for a kind keyed per object (one connection's
 * leads backfill), where `lastDoneJob`'s (org, kind) answer would be another object's run.
 */
export async function lastDoneJobByKey(
  admin: SupabaseClient,
  orgId: string,
  kind: JobKind,
  dedupKey: string,
): Promise<JobRow | null> {
  const { data, error } = await admin
    .from("jobs")
    .select("*")
    .eq("org_id", orgId)
    .eq("kind", kind)
    .eq("dedup_key", dedupKey)
    .eq("status", "done")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`jobs: ${error.message}`);
  return (data as JobRow | null) ?? null;
}
