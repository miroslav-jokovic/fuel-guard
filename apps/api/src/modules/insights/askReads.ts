import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The two reads the older assistant tools (`fleet_summary`, `top_risk`, `fuel_ranking`…) sum over,
 * split out of `askData.ts` when the streamed loop (F21 Step 2d) took it past the 500-line budget.
 */

/** Fetch every row of a query by paging in 1000-row windows (PostgREST caps a page at 1000) — so
 *  aggregates are correct for orgs with more than 1000 rows in the window. Bounded to 50 pages. */
export async function fetchAllPaged<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let page = 0; page < 50; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

export async function nameMaps(admin: SupabaseClient, orgId: string) {
  const [{ data: veh }, { data: drv }] = await Promise.all([
    admin.from("vehicles").select("id, unit_number").eq("org_id", orgId),
    admin.from("drivers").select("id, full_name").eq("org_id", orgId),
  ]);
  return {
    unit: new Map((veh ?? []).map((v) => [v.id as string, v.unit_number as string])),
    driver: new Map((drv ?? []).map((d) => [d.id as string, d.full_name as string])),
  };
}
