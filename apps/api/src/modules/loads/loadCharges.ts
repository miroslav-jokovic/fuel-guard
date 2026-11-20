import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoadCharges } from "@silvicom/shared";
import { chunks } from "../../lib/paging.js";

/**
 * What each load pays, read from `load_charges` (0639) — the one reader behind every screen that shows a
 * load's price (LOAD-RATES-PLAN R3, D-RATE7).
 *
 * ⚠ The CALLER asks `holdsNamedPermission(req, LOAD_RATES_PERMISSION)` first and calls this only on a yes.
 * The table is deny-all to the browser (RLS on, no policies) and this read is the service role's, so this
 * function is the only door to the figures, and it is opened per request, never from a cache shared
 * between readers: the board's 20-second row cache is per ORG, and a price must not ride it to a
 * dispatcher the carrier has not switched on.
 *
 * Org-filtered as well as id-filtered (the service role bypasses RLS), and in `IN_LIST_CHUNK` slices: one
 * `.in()` over the Loads page's few thousand ids would overflow Node 22's response-header limit — the
 * failure that took the board down at 454 loads (`chunks`).
 *
 * A failed read THROWS, failing the request, the precedent the stops read beside it set
 * (`listLoads`): answering without prices would show a holder "—" on every load, which reads as "McLeod
 * states no price", a false statement where an error is a true one.
 */
const COLUMNS = "load_id, total_charge, linehaul, other_charges, currency, billed_miles, order_loaded_movements";

/** PostgREST returns `numeric` as a string (`loadsContract.ts` header); a null stays null. */
const num = (v: unknown): number | null => (v == null ? null : Number(v));

export async function readLoadCharges(
  admin: SupabaseClient,
  orgId: string,
  loadIds: readonly string[],
): Promise<Map<string, LoadCharges>> {
  const byLoad = new Map<string, LoadCharges>();
  for (const ids of chunks([...new Set(loadIds)])) {
    const { data, error } = await admin.from("load_charges").select(COLUMNS).eq("org_id", orgId).in("load_id", ids);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      byLoad.set(String(r.load_id), {
        total_charge: Number(r.total_charge),
        linehaul: num(r.linehaul),
        other_charges: num(r.other_charges),
        currency: r.currency == null ? null : String(r.currency),
        billed_miles: num(r.billed_miles),
        order_loaded_movements: num(r.order_loaded_movements),
      });
    }
  }
  return byLoad;
}

/**
 * Each row with its `charges` — the stored price, or `null` when McLeod states none for that load (an
 * empty or voided movement, D-RATE3). Only ever called for a caller who holds the switch; for anyone else
 * the route sends the rows as they were, with no `charges` key at all.
 */
export async function withLoadCharges<T extends { id: string }>(
  admin: SupabaseClient,
  orgId: string,
  rows: readonly T[],
): Promise<(T & { charges: LoadCharges | null })[]> {
  const charges = await readLoadCharges(admin, orgId, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, charges: charges.get(r.id) ?? null }));
}
