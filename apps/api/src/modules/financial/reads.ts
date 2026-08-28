import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The financial store's read interface (P5.1/P5.2 substrate). Every reader applies THE
 * canonical predicate — `is_canonical and not is_void` — by default, because that is the only
 * way a sum over this table is true (D-FS1); drill-down callers opt out explicitly and say why.
 *
 * Aggregations run in TypeScript over paged canonical rows for v1 — the 0245 lesson says
 * optimize into a SQL function when the pain is MEASURED, not preemptively (that RPC exists
 * because a page took 30 seconds, and its shape was chosen from the measurement). The windowed
 * predicates ride the 0257 partial indexes, which exist for exactly these access paths.
 */

export interface EntryFilter {
  q?: string;
  category?: string;
  direction?: "earning" | "expense";
  vehicleId?: string;
  driverId?: string;
  from?: string;
  to?: string;
  /** Default TRUE — reports must not double-count. Drill-down opts out deliberately. */
  canonicalOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface FinancialEntryRow {
  id: string;
  direction: string;
  category: string;
  amount: number | string;
  occurred_at: string;
  settled_at: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  source: string;
  source_table: string;
  external_id: string;
  lifecycle_stage: string;
  is_canonical: boolean;
  is_void: boolean;
  ledger_account: string | null;
}

const ENTRY_COLUMNS =
  "id, direction, category, amount, occurred_at, settled_at, vehicle_id, driver_id, source, source_table, external_id, lifecycle_stage, is_canonical, is_void, ledger_account";

/** Individually visible, separated, easily searchable — the owner's stated goal, as one query. */
export async function searchEntries(
  admin: SupabaseClient,
  orgId: string,
  f: EntryFilter,
): Promise<{ entries: FinancialEntryRow[]; total: number }> {
  const limit = Math.min(f.limit ?? 50, 200);
  const offset = f.offset ?? 0;
  let q = admin
    .from("financial_entries")
    .select(ENTRY_COLUMNS, { count: "exact" })
    .eq("org_id", orgId);
  if (f.canonicalOnly !== false) q = q.eq("is_canonical", true).eq("is_void", false);
  if (f.category) q = q.eq("category", f.category);
  if (f.direction) q = q.eq("direction", f.direction);
  if (f.vehicleId) q = q.eq("vehicle_id", f.vehicleId);
  if (f.driverId) q = q.eq("driver_id", f.driverId);
  if (f.from) q = q.gte("occurred_at", f.from);
  if (f.to) q = q.lt("occurred_at", f.to);
  // external_id reaches one payment by its own reference (the 0257 index); ledger keys too.
  if (f.q) q = q.or(`external_id.ilike.%${f.q}%,ledger_account.ilike.%${f.q}%`);
  const { data, error, count } = await q
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false }) // stable UI pagination under tied timestamps
    .range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  return { entries: (data ?? []) as unknown as FinancialEntryRow[], total: count ?? 0 };
}

/** Canonical rows for a window, paged fully — the aggregation substrate. */
async function canonicalWindow(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<FinancialEntryRow[]> {
  const PAGE = 1000;
  const out: FinancialEntryRow[] = [];
  for (let p = 0; ; p += PAGE) {
    const { data, error } = await admin
      .from("financial_entries")
      .select(ENTRY_COLUMNS)
      .eq("org_id", orgId)
      .eq("is_canonical", true)
      .eq("is_void", false)
      .gte("occurred_at", from)
      .lt("occurred_at", to)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true }) // tie-heavy timestamps page unstably alone (financialReads lesson)
      .range(p, p + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as FinancialEntryRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export interface CategorySummary {
  category: string;
  direction: string;
  entries: number;
  amount: number;
}

/** Spend/earnings by category over a window — the ledger's one-glance shape. */
export async function summarizeByCategory(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<CategorySummary[]> {
  const rows = await canonicalWindow(admin, orgId, from, to);
  const byKey = new Map<string, CategorySummary>();
  for (const r of rows) {
    const key = `${r.direction}:${r.category}`;
    const cur = byKey.get(key) ?? { category: r.category, direction: r.direction, entries: 0, amount: 0 };
    cur.entries++;
    cur.amount = Math.round((cur.amount + Number(r.amount)) * 100) / 100;
    byKey.set(key, cur);
  }
  return [...byKey.values()].sort((a, b) => b.amount - a.amount);
}

export interface VehicleMoney {
  vehicleId: string | null;
  earnings: number;
  expenses: number;
  margin: number;
  entries: number;
}

/**
 * Earnings vs expenses per truck — margin per truck on the same terms as cost per mile, plus
 * the honest bucket: `vehicleId null` is money the SOURCE did not attribute (D-FS5), shown as
 * its own row rather than spread by a guess nobody signed off.
 */
export async function moneyByVehicle(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<VehicleMoney[]> {
  const rows = await canonicalWindow(admin, orgId, from, to);
  const byVeh = new Map<string | null, VehicleMoney>();
  for (const r of rows) {
    const cur = byVeh.get(r.vehicle_id) ?? { vehicleId: r.vehicle_id, earnings: 0, expenses: 0, margin: 0, entries: 0 };
    const amt = Number(r.amount);
    if (r.direction === "earning") cur.earnings += amt;
    else cur.expenses += amt;
    cur.entries++;
    byVeh.set(r.vehicle_id, cur);
  }
  for (const v of byVeh.values()) {
    v.earnings = Math.round(v.earnings * 100) / 100;
    v.expenses = Math.round(v.expenses * 100) / 100;
    v.margin = Math.round((v.earnings - v.expenses) * 100) / 100;
  }
  return [...byVeh.values()].sort((a, b) => b.margin - a.margin);
}

export interface AccountSpend {
  ledgerAccount: string;
  vouchers: number;
  amount: number;
}

/**
 * AP spend by GL account — the allocation-rule inventory (FINANCIAL-STORE-PLAN §6). Not an
 * allocation: it answers "what buckets of unattributed cost exist and how big are they", the
 * question finance must answer before signing an allocation rule (§6 Q5 stays open until they
 * do; until then overhead is unallocated and this is the artifact that says so).
 */
export async function apSpendByAccount(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<AccountSpend[]> {
  const rows = await canonicalWindow(admin, orgId, from, to);
  const byAccount = new Map<string, AccountSpend>();
  for (const r of rows) {
    if (r.source_table !== "mcleod_ap_vouchers") continue;
    const key = r.ledger_account?.trim() || "(unclassified)";
    const cur = byAccount.get(key) ?? { ledgerAccount: key, vouchers: 0, amount: 0 };
    cur.vouchers++;
    cur.amount = Math.round((cur.amount + Number(r.amount)) * 100) / 100;
    byAccount.set(key, cur);
  }
  return [...byAccount.values()].sort((a, b) => b.amount - a.amount);
}
