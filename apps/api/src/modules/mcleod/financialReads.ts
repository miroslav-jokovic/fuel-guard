import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The collector's read interface over its own financial staging (D-SEP1 — nothing outside
 * mcleod touches these raw tables directly; the `financial` projection asks HERE). Windowed on
 * each domain's economic date, matching what the projection buckets by (D-FS6).
 */
export interface StagedSettlement {
  id: string;
  external_id: string;
  tractor_unit: string | null;
  driver_external_id: string | null;
  payee_type: string;
  accrued_at: string | null;
  paid_at: string | null;
  total_pay: number | string;
  /** The figure that ties to the ledger's SET module (D-MC24) — coverage claims use it. */
  posted_pay: number | string;
  is_void: boolean;
  accrual_key: string | null;
}

export interface StagedGlTotal {
  post_module: string;
  glid: string;
  line_count: number;
  net_amount: number | string;
  abs_amount: number | string;
}

export interface StagedVoucher {
  id: string;
  external_id: string;
  vendor_id: string | null;
  invoice_date: string | null;
  distribution_date: string | null;
  amount: number | string;
  ap_glid: string | null;
  is_paid: boolean;
  check_number: string | null;
  post_key: string | null;
  post_module: string | null;
}

export interface StagedBilling {
  id: string;
  external_id: string;
  order_external_id: string | null;
  tractor_unit: string | null;
  driver_external_id: string | null;
  bill_date: string | null;
  transfer_date: string | null;
  total_charges: number | string;
  other_charge: number | string;
  excise_tax: number | string;
  post_key: string | null;
  post_module: string | null;
}

const PAGE = 1000;

async function paged<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function readSettlementsWindow(admin: SupabaseClient, orgId: string, fromIso: string, toIso: string): Promise<StagedSettlement[]> {
  return paged<StagedSettlement>((from, to) =>
    admin
      .from("mcleod_settlements")
      .select("id, external_id, tractor_unit, driver_external_id, payee_type, accrued_at, paid_at, total_pay, posted_pay, is_void, accrual_key")
      .eq("org_id", orgId)
      .gte("accrued_at", fromIso)
      .lt("accrued_at", toIso)
      .order("accrued_at", { ascending: true })
      // Tiebreaker: settlements batch-share accrued_at to the SECOND (D-MC29 — 70.3% of
      // consecutive same-tractor pairs). A tied sort is not a total order, and .range() paging
      // over one repeats and drops boundary rows — the first full projection hit exactly that
      // ("ON CONFLICT DO UPDATE command cannot affect row a second time", 2026-08-28).
      .order("id", { ascending: true })
      .range(from, to),
  );
}

export async function readApVouchersWindow(admin: SupabaseClient, orgId: string, fromIso: string, toIso: string): Promise<StagedVoucher[]> {
  return paged<StagedVoucher>((from, to) =>
    admin
      .from("mcleod_ap_vouchers")
      .select("id, external_id, vendor_id, invoice_date, distribution_date, amount, ap_glid, is_paid, check_number, post_key, post_module")
      .eq("org_id", orgId)
      .gte("distribution_date", fromIso)
      .lt("distribution_date", toIso)
      .order("distribution_date", { ascending: true })
      .order("id", { ascending: true }) // same-day vouchers tie; see the settlements tiebreaker
      .range(from, to),
  );
}

export async function readBillingWindow(admin: SupabaseClient, orgId: string, fromIso: string, toIso: string): Promise<StagedBilling[]> {
  return paged<StagedBilling>((from, to) =>
    admin
      .from("mcleod_billing")
      .select("id, external_id, order_external_id, tractor_unit, driver_external_id, bill_date, transfer_date, total_charges, other_charge, excise_tax, post_key, post_module")
      .eq("org_id", orgId)
      .gte("bill_date", fromIso)
      .lt("bill_date", toIso)
      .order("bill_date", { ascending: true })
      .order("id", { ascending: true }) // ~80 invoices share each bill_date; see the settlements tiebreaker
      .range(from, to),
  );
}

/** One month's GL control totals (0269) — the figures every subledger claim is checked against. */
export async function readLedgerTotals(
  admin: SupabaseClient,
  orgId: string,
  periodStart: string,
): Promise<StagedGlTotal[]> {
  return paged<StagedGlTotal>((from, to) =>
    admin
      .from("mcleod_gl_totals")
      .select("post_module, glid, line_count, net_amount, abs_amount")
      .eq("org_id", orgId)
      .eq("period_start", periodStart)
      .order("post_module", { ascending: true })
      .order("glid", { ascending: true }) // (period, module, glid) is the row identity — a total order
      .range(from, to),
  );
}

export interface StagedMovement {
  external_id: string;
  tractor_unit: string | null;
  trailer_unit: string | null;
  driver_external_ids: string[];
  order_ids: string[];
  loaded_miles: number | string | null;
  fuel_miles: number | string | null;
  distance_unit: string;
  settled_at: string | null;
  /** The ordered stop array, exactly as tmsStopFactSchema shaped it on the way in (0267). */
  stops: unknown;
}

/** Settled movements over a window — the cents-per-mile denominator (0267). */
export async function readMovementsWindow(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<StagedMovement[]> {
  return paged<StagedMovement>((from, to) =>
    admin
      .from("mcleod_movements")
      .select("external_id, tractor_unit, trailer_unit, driver_external_ids, order_ids, loaded_miles, fuel_miles, distance_unit, settled_at, stops")
      .eq("org_id", orgId)
      .gte("settled_at", fromIso)
      .lt("settled_at", toIso)
      .order("settled_at", { ascending: true })
      .order("external_id", { ascending: true }) // settled_at is batch-shared (D-MC29); see the settlements tiebreaker
      .range(from, to),
  );
}

/** The chart of accounts (0272): glid → McLeod's own name and P&L class. */
export interface StagedGlAccount {
  glid: string;
  descr: string | null;
  type_id: string | null;
}

export async function readGlAccounts(admin: SupabaseClient, orgId: string): Promise<StagedGlAccount[]> {
  return paged<StagedGlAccount>((from, to) =>
    admin
      .from("mcleod_gl_accounts")
      .select("glid, descr, type_id")
      .eq("org_id", orgId)
      .order("glid", { ascending: true }) // glid is unique per org — a total order
      .range(from, to),
  );
}
