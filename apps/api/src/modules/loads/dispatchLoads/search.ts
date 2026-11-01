import type { SupabaseClient } from "@supabase/supabase-js";
import { RECORD_SEARCH_LIMIT, recordSearchPattern, recordSearchTerm, type LoadSearchHit } from "@silvicom/shared";
import { one, type Join } from "./shared.js";

/**
 * Loads whose number contains the term — the ⌘K palette's load half (SIDEBAR-REDESIGN-PLAN.md D-SB8).
 *
 * Its own small read rather than the board's: `listLoads` pages through every load the org has, with
 * stops, dispatches and dispatcher names, which is the right price for the board and the wrong one for
 * a keystroke. This asks for five rows by `ref` and the two names a person recognises a load by.
 *
 * Newest first, because a number typed from memory is nearly always this week's load; a load number
 * McLeod reused years apart would otherwise surface its oldest holder.
 *
 * The service role bypasses RLS, so the org filter here is the whole boundary, not a second lock.
 */
export async function searchLoads(admin: SupabaseClient, orgId: string, raw: string): Promise<LoadSearchHit[]> {
  const term = recordSearchTerm(raw);
  if (!term) return [];
  const { data, error } = await admin
    .from("loads")
    .select("id, ref, customer_name, created_at, drivers(full_name)")
    .eq("org_id", orgId)
    .ilike("ref", recordSearchPattern(term))
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(RECORD_SEARCH_LIMIT);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as (Record<string, unknown> & { drivers: Join })[]).map((r) => ({
    id: String(r.id),
    ref: String(r.ref ?? ""),
    customer_name: (r.customer_name as string | null) ?? null,
    driver_name: one(r.drivers)?.full_name ?? null,
  }));
}
