import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Give theft cases an owner, on behalf of the Findings inbox (C7b merge 3).
 *
 * ── WHY IT LIVES HERE AND NOT IN THE INBOX THAT CALLS IT ────────────────────────────────────────
 * `anomalies` is this module's table (docs/ARCHITECTURE.md §3) and it had exactly one writer.
 * `findingsAssign.ts` updating it directly would have been the first write from outside, and
 * `lint:table-writers` said so. Routing it through the owner is that gate's own instruction — the
 * same answer `markFuelSweepComplete` gave when the fuel sweep needed to stamp `organizations`.
 *
 * ⚠ It assigns and does NOTHING else, deliberately. The caller has already decided WHO may assign
 * WHAT — the per-kind gate is `rolesThatManageFinding` and it lives with the inbox, because that is
 * the question the inbox answers. What this function owns is that a write to `anomalies` is
 * org-scoped and touches one column. Widening it later to set a status or a disposition would move a
 * close decision out of the module that defines what closing means, which is the seam D-FUI7 exists
 * to keep.
 */
export async function assignAnomalies(
  admin: SupabaseClient,
  orgId: string,
  ids: readonly string[],
  assignee: string | null,
): Promise<{ ok: boolean }> {
  if (ids.length === 0) return { ok: true };
  // The service role bypasses RLS, so this carries its own tenant scope even though the caller
  // already resolved these ids against the same org: two statements, and the second does not inherit
  // the first's scope on trust.
  const { error } = await admin
    .from("anomalies")
    .update({ assigned_to: assignee })
    .eq("org_id", orgId)
    .in("id", [...ids]);
  return { ok: !error };
}
