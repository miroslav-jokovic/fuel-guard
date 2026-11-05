import type { SupabaseClient } from "@supabase/supabase-js";
import { mismatchKey, type ReconcileMismatch } from "@silvicom/shared";

/**
 * Which refusals mean an object of ours is gone, and whether that is already on the record (Q-AD35).
 *
 * ── WHY A REFUSAL ALONE IS NOT ENOUGH ───────────────────────────────────────────────
 * A campaign deleted at Meta used to fail `ads_insights` and `ads_reconcile` on every run until someone archived
 * it: reconcile rang once, as it should, and then the jobs kept reading the object and throwing. A failure that
 * repeats forever about a fact already rung is noise that hides the next real one.
 *
 * But the hourly reads must not simply believe "does not exist". This is the one place a failed read stops being a
 * failure, so it asks for two things: Meta's refusal now, and reconcile's `missing` row for that object. The first
 * run after a deletion therefore still fails, which is the loud path, and a person has been told by the time the
 * failure stops. Every other refusal stays a failure, whatever the ledger holds.
 *
 * The read is always attempted first, so if Meta does keep answering for a deleted campaign (the L4 question), its
 * hours keep arriving and nothing here runs.
 */

/** Meta's "does not exist" (code 100, subcode 33) — the one refusal that means the object is gone. */
export const isNoSuchObject = (e: { code: number | null; subcode: number | null }): boolean => e.code === 100 && e.subcode === 33;

/** The ledger row a mismatch is recorded under; `reconcile.ts` writes it and `recordedGone` reads it. */
export const externalChangeKey = (connectionId: string, key: string): string => `external_change:${connectionId}:${key}`;

export type GoneObject = Pick<ReconcileMismatch, "level" | "meta_id">;

/** Has reconcile recorded any of these objects as no longer at Meta on this connection? */
export async function recordedGone(admin: SupabaseClient, orgId: string, connectionId: string, objects: GoneObject[]): Promise<boolean> {
  const keys = objects.map((o) => externalChangeKey(connectionId, mismatchKey({ ...o, field: "missing", theirs: null })));
  const { data, error } = await admin
    .from("ads_actions").select("id")
    .eq("org_id", orgId).eq("status", "succeeded").in("idempotency_key", keys).limit(1);
  if (error) throw new Error(`ads_actions: ${error.message}`);
  return (data ?? []).length > 0;
}
