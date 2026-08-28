import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readSettlementsWindow,
  readApVouchersWindow,
  readBillingWindow,
  type StagedSettlement,
  type StagedVoucher,
  type StagedBilling,
} from "../mcleod/index.js";

/**
 * The projection — staging becomes the canonical financial fact (FINANCIAL-STORE-PLAN §5.1,
 * program step P3.4, docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md). Every rule that keeps
 * one payment from being counted twice lives HERE, once, instead of in every report:
 *
 *  · Settlements → `driver_pay`/`contractor_pay` by payee (D-MC13's C-vs-O split: $378 vs $2,932
 *    a row — pooling them describes no truck), lifecycle `accrual`, occurred_at = accrual date
 *    (D-FS6 — the $135k lesson), amount = total_pay (the real cost; posted_pay is the
 *    reconciliation figure and stays in staging).
 *  · AP vouchers → `ap_expense`, lifecycle `invoice`, occurred_at = distribution date. The
 *    FUEL-VENDOR vouchers (D-FS2) land as category `fuel` and NON-canonical: EFS is
 *    authoritative for fuel, and a monthly vendor invoice cannot share a per-fill dedup_key —
 *    the flag, not the key, is what keeps the $1,017,601.81 from counting twice.
 *  · Billing → `linehaul_revenue` (total_charges) plus a second `accessorial_revenue` entry
 *    when other_charge > 0 — the lane's worth and the day's extras answer different questions.
 *    excise_tax is deliberately NOT projected: collected for the government is not revenue.
 *  · EFS fills → category `fuel`, canonical, lifecycle `payment` (a card purchase is a
 *    cash-equivalent event at the pump). Fills with no total_cost are skipped and counted —
 *    a fill without a price is a recon problem, not a financial fact.
 *
 * Attribution is EXACTLY what the source asserted (D-FS5): tractor units resolve against
 * roster unit numbers, McLeod driver ids against drivers.mcleod_driver_id, and a miss stays
 * null — a fact, not a gap.
 *
 * Idempotent on (org_id, source, source_table, external_id) — the 0257 source-row index — so
 * re-projecting a window converges. The canonical guarantee itself is the database's
 * (uq_financial_entries_canonical); this service computes keys and flags, the index enforces.
 */

export interface ProjectionResult {
  settlements: number;
  vouchers: number;
  billing: number;
  /** Staged billing rows the GL never booked — held out of reports, never silently dropped. */
  unpostedBilling: number;
  fuelFills: number;
  skippedFuelNoCost: number;
  entriesUpserted: number;
}

/** The fuel-card vendor(s) whose AP invoices duplicate EFS fuel (measured 2026-08-24: 59 of
 *  June's 183 expense rows, the same $1,017,601.81; re-measured 2026-07: $1,074,669.07 of the
 *  month's $1,491,893 voucher total). Grows per onboarded carrier — with the measurement that
 *  justifies each entry, like the GLID prefixes in packages/shared/tmsCost. Exported because the
 *  CPM endpoint must apply the SAME D-FS2 rule to its overhead pool — it didn't, and the pool
 *  double-counted ~$1M/month of fuel until the owner's 2026-08-28 fleet-net reconciliation. */
export const FUEL_AP_VENDOR_IDS = new Set(["PILOKNTN"]);

const CHUNK = 500;

type Entry = Record<string, unknown>;

function num(v: number | string | null | undefined): number {
  return v == null ? 0 : typeof v === "number" ? v : Number(v);
}

function settlementEntry(orgId: string, s: StagedSettlement, vehicleId: string | null, driverId: string | null): Entry {
  return {
    org_id: orgId,
    direction: "expense",
    category: s.payee_type === "owner_operator" ? "contractor_pay" : s.payee_type === "company_driver" ? "driver_pay" : "other",
    amount: num(s.total_pay),
    occurred_at: s.accrued_at,
    settled_at: s.paid_at,
    vehicle_id: vehicleId,
    driver_id: driverId,
    load_id: null,
    source: "mcleod",
    source_table: "mcleod_settlements",
    source_row_id: s.id,
    external_id: s.external_id,
    lifecycle_stage: "accrual",
    dedup_key: `set:${s.external_id}`,
    is_canonical: true,
    is_void: s.is_void,
    ledger_post_key: s.accrual_key,
    ledger_module: "SET",
    ledger_account: null,
  };
}

function voucherEntry(orgId: string, v: StagedVoucher): Entry {
  const isFuelVendor = v.vendor_id != null && FUEL_AP_VENDOR_IDS.has(v.vendor_id);
  return {
    org_id: orgId,
    direction: "expense",
    category: isFuelVendor ? "fuel" : "ap_expense",
    amount: num(v.amount),
    occurred_at: v.distribution_date ?? v.invoice_date,
    settled_at: v.is_paid ? (v.distribution_date ?? v.invoice_date) : null,
    vehicle_id: null, // D-FS5: voucher_hist carries no equipment; null is a fact
    driver_id: null,
    load_id: null,
    source: "mcleod",
    source_table: "mcleod_ap_vouchers",
    source_row_id: v.id,
    external_id: v.external_id,
    lifecycle_stage: "invoice",
    dedup_key: `ap:${v.external_id}`,
    // D-FS2: the fuel-vendor invoice is the same money EFS already holds per fill. Non-canonical
    // keeps it reachable for drill-down and invisible to every report that sums.
    is_canonical: !isFuelVendor,
    is_void: false,
    ledger_post_key: v.post_key,
    ledger_module: v.post_module,
    ledger_account: v.ap_glid,
  };
}

function billingEntries(orgId: string, b: StagedBilling, vehicleId: string | null, driverId: string | null): Entry[] {
  const base = {
    org_id: orgId,
    direction: "earning",
    occurred_at: b.bill_date,
    settled_at: b.transfer_date,
    vehicle_id: vehicleId,
    driver_id: driverId,
    load_id: null,
    source: "mcleod",
    source_table: "mcleod_billing",
    source_row_id: b.id,
    lifecycle_stage: "invoice",
    is_void: false,
    ledger_post_key: b.post_key,
    ledger_module: b.post_module,
    ledger_account: null,
  };
  const out: Entry[] = [
    {
      ...base,
      category: "linehaul_revenue",
      amount: num(b.total_charges),
      external_id: b.external_id,
      dedup_key: `bill:${b.external_id}`,
      is_canonical: true,
    },
  ];
  if (num(b.other_charge) !== 0) {
    out.push({
      ...base,
      category: "accessorial_revenue",
      amount: num(b.other_charge),
      external_id: `${b.external_id}:acc`,
      dedup_key: `bill:${b.external_id}:acc`,
      is_canonical: true,
    });
  }
  return out;
}

async function upsertEntries(admin: SupabaseClient, entries: Entry[]): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const part = entries.slice(i, i + CHUNK);
    const { data, error } = await admin
      .from("financial_entries")
      .upsert(part, { onConflict: "org_id,source,source_table,external_id" })
      .select("id");
    if (error) throw new Error(`financial_entries upsert failed: ${error.message}`);
    upserted += data?.length ?? part.length;
  }
  return upserted;
}

/** Roster resolution maps, loaded once per run: unit number → vehicle id, McLeod driver id → driver id. */
async function loadResolution(admin: SupabaseClient, orgId: string) {
  const [veh, drv] = await Promise.all([
    admin.from("vehicles").select("id, unit_number").eq("org_id", orgId),
    admin.from("drivers").select("id, mcleod_driver_id").eq("org_id", orgId).not("mcleod_driver_id", "is", null),
  ]);
  if (veh.error) throw new Error(veh.error.message);
  if (drv.error) throw new Error(drv.error.message);
  const vehicleByUnit = new Map<string, string>();
  for (const v of (veh.data ?? []) as { id: string; unit_number: string | null }[]) {
    if (v.unit_number) vehicleByUnit.set(v.unit_number.trim(), v.id);
  }
  const driverByMcleod = new Map<string, string>();
  for (const d of (drv.data ?? []) as { id: string; mcleod_driver_id: string | null }[]) {
    if (d.mcleod_driver_id) driverByMcleod.set(d.mcleod_driver_id.trim(), d.id);
  }
  return { vehicleByUnit, driverByMcleod };
}

export async function projectFinancialWindow(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<ProjectionResult> {
  const { vehicleByUnit, driverByMcleod } = await loadResolution(admin, orgId);
  const resolve = (unit: string | null, mcleodDriver: string | null) => ({
    vehicleId: unit ? (vehicleByUnit.get(unit.trim()) ?? null) : null,
    driverId: mcleodDriver ? (driverByMcleod.get(mcleodDriver.trim()) ?? null) : null,
  });

  const entries: Entry[] = [];

  const settlements = await readSettlementsWindow(admin, orgId, fromIso, toIso);
  for (const s of settlements) {
    const { vehicleId, driverId } = resolve(s.tractor_unit, s.driver_external_id);
    entries.push(settlementEntry(orgId, s, vehicleId, driverId));
  }

  const vouchers = await readApVouchersWindow(admin, orgId, fromIso, toIso);
  for (const v of vouchers) entries.push(voucherEntry(orgId, v));

  // Only GL-BOOKED revenue projects (post_key present, module BILL): 0257 measured June 2026 at
  // 1,640 staged rows of which exactly 1,595 posted one-line-per-invoice — the other 45 are
  // whatever `canceled`/`rebilled` will turn out to mean (recon F3, still owed), and until that
  // vocabulary is MEASURED they stay in staging, visible and uncounted. The GL is the control
  // (D-MC12); a predicate built on an unmeasured flag would be a guess wearing a filter.
  let unpostedBilling = 0;
  const billing = await readBillingWindow(admin, orgId, fromIso, toIso);
  for (const b of billing) {
    if (!b.post_key || b.post_module !== "BILL") {
      unpostedBilling++;
      continue;
    }
    const { vehicleId, driverId } = resolve(b.tractor_unit, b.driver_external_id);
    entries.push(...billingEntries(orgId, b, vehicleId, driverId));
  }

  // EFS fills — the canonical fuel record (D-FS2). Core-table read, org-scoped, windowed on the
  // transaction time (the economic date for fuel).
  let fuelFills = 0;
  let skippedFuelNoCost = 0;
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("fuel_transactions")
      .select("id, external_ref, fueled_at, total_cost, vehicle_id, driver_id, is_canonical")
      .eq("org_id", orgId)
      .gte("fueled_at", fromIso)
      .lt("fueled_at", toIso)
      .order("fueled_at", { ascending: true })
      // Two pumps stamp the same second; a tied sort pages unstably (the financialReads lesson).
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as {
      id: string; external_ref: string | null; fueled_at: string; total_cost: number | string | null;
      vehicle_id: string | null; driver_id: string | null; is_canonical: boolean;
    }[];
    for (const f of rows) {
      // A non-canonical fill is a detected twin (0160): its money is already carried by its keeper.
      if (!f.is_canonical) continue;
      if (f.total_cost == null) {
        skippedFuelNoCost++;
        continue;
      }
      fuelFills++;
      entries.push({
        org_id: orgId,
        direction: "expense",
        category: "fuel",
        amount: num(f.total_cost),
        occurred_at: f.fueled_at,
        settled_at: f.fueled_at,
        vehicle_id: f.vehicle_id,
        driver_id: f.driver_id,
        load_id: null,
        source: "efs",
        source_table: "fuel_transactions",
        source_row_id: f.id,
        external_id: f.external_ref ?? f.id,
        lifecycle_stage: "payment",
        dedup_key: `fuel:efs:${f.external_ref ?? f.id}`,
        is_canonical: true,
        is_void: false,
        ledger_post_key: null,
        ledger_module: null,
        ledger_account: null,
      });
    }
    if (rows.length < PAGE) break;
  }

  const entriesUpserted = await upsertEntries(admin, entries);
  return {
    settlements: settlements.length,
    vouchers: vouchers.length,
    billing: billing.length,
    unpostedBilling,
    fuelFills,
    skippedFuelNoCost,
    entriesUpserted,
  };
}
