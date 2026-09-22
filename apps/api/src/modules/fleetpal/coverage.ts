import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeCoverage,
  GL_FAMILIES,
  type CoverageInvoice,
  type CoverageMonth,
  type CoverageVoucher,
} from "@silvicom/shared";
import { readLedgerTotalsRange, readVoucherNumbersWindow } from "../mcleod/index.js";
import { countUnmatched } from "./units.js";

/**
 * The coverage ratio's reads (FLEETPAL-INTEGRATION-PLAN.md F9b, §2.4, D-FP4, D-FP15, D-FP17).
 *
 * The arithmetic is pure and lives in `@silvicom/shared`'s `computeCoverage`, which is where the
 * argument for why this is a BOUND is written down. This file only fetches the three inputs and
 * hands them over.
 *
 * ── TWO MODULE EDGES, DECLARED RATHER THAN TAKEN (D-ARC3) ─────────────────────────────────────
 * `fleetpal -> mcleod` for the denominator and the AP vouchers, both through McLeod's own exported
 * readers and never through `.from("mcleod_*")`, which `lint:table-access` would refuse and
 * `lint:boundaries` records the reason for. The collector owns its raw layer and so does McLeod.
 */

/** The signed maintenance family (`tmsCost/glFamilies.ts`, owner 2026-09-03) — 15 accounts. */
const MAINTENANCE_GLIDS = new Set(
  GL_FAMILIES.find((f) => f.key === "maintenance")?.glids ?? [],
);

export interface CoverageAnswer {
  months: CoverageMonth[];
  /**
   * D-FP14: the count of FleetPal units this org has not resolved to a vehicle or trailer travels
   * beside every cost figure. 48 of 474 on the live account, 2026-09-21 — mostly sold or
   * superseded equipment, which is a reconciliation somebody can finish rather than an error.
   */
  unmatchedUnits: number;
}

/**
 * ⚠ `from` and `to` are half-open `YYYY-MM-DD` wall-clock dates in the carrier's own calendar, not
 * instants. Every financial window in this stack is (D-FIN9, `wallClock.ts`): McLeod stamps arrive
 * as local wall time labelled UTC, so comparing them against a UTC-shifted window moves rows into
 * the previous evening — 890 entries and $1.29M of them, measured 2026-09-03.
 */
export async function readCoverage(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<CoverageAnswer> {
  const months = monthsBetween(from, to);
  const [denominators, invoices, vouchers, unmatchedUnits] = await Promise.all([
    readMaintenanceFamilyByMonth(admin, orgId, months),
    readFleetpalInvoices(admin, orgId, from, to),
    readLedgerVouchers(admin, orgId, from, to),
    countUnmatched(admin, orgId),
  ]);
  return { months: computeCoverage(denominators, invoices, vouchers), unmatchedUnits };
}

/**
 * The denominator: the maintenance family's total per month.
 *
 * ⚠ **A month with no rows is `null`, never 0.** `mcleod_gl_totals` only holds a month the sweep
 * has reached, and "the ledger has not been swept for August" is not "the company spent nothing on
 * maintenance in August". A zero there would print a 0% coverage ratio — a statement about the
 * shop — when the true statement is about our own data. `computeCoverage` turns that null into a
 * null ratio, and a null ratio is what refuses to print the cost figure at all (D-FP4).
 */
async function readMaintenanceFamilyByMonth(
  admin: SupabaseClient,
  orgId: string,
  months: string[],
): Promise<Array<{ month: string; familyTotal: number | null }>> {
  if (months.length === 0) return [];
  const rows = await readLedgerTotalsRange(admin, orgId, `${months[0]}-01`, nextMonthStart(months.at(-1)!));
  const byMonth = new Map<string, number>();
  for (const row of rows) {
    if (!MAINTENANCE_GLIDS.has(row.glid)) continue;
    const key = String(row.period_start).slice(0, 7);
    // `net_amount`, not `abs_amount`: a credit memo against a repair genuinely reduces what the
    // company spent that month, and `abs_amount` would add it instead.
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(row.net_amount));
  }
  return months.map((month) => ({ month, familyTotal: byMonth.get(month) ?? null }));
}

/** PostgREST caps every response at 1,000 rows whatever `.limit()` says; the walk is the defence. */
const PAGE = 1000;

/**
 * FleetPal's own invoices for the window, reduced to the four fields the bound needs.
 *
 * ⚠ The number is passed through EXACTLY as staged (D-FP16). Trimming or case-folding it here
 * would be indistinguishable at read from a real match and would turn the stated bound back into
 * the guess Q9 rejected. An invoice with no number at all is dropped rather than matched on an
 * empty string, which would collide with every other unnumbered invoice at once.
 */
async function readFleetpalInvoices(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<CoverageInvoice[]> {
  const out: CoverageInvoice[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await admin
      .from("fleetpal_po_invoices")
      .select("id, invoice_number, invoice_type, invoice_date, amount")
      .eq("org_id", orgId)
      .gte("invoice_date", from)
      .lt("invoice_date", to)
      .order("invoice_date", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + PAGE - 1);
    if (error) throw new Error(`fleetpal_po_invoices read failed: ${error.message}`);
    const rows = (data ?? []) as Array<{
      invoice_number: string | null;
      invoice_type: string | null;
      invoice_date: string | null;
      amount: number | string | null;
    }>;
    for (const r of rows) {
      if (!r.invoice_number || !r.invoice_date) continue;
      out.push({
        number: r.invoice_number,
        month: r.invoice_date.slice(0, 7),
        amount: Number(r.amount ?? 0),
        isCredit: r.invoice_type === "CREDIT",
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/** The AP ledger's side, read through McLeod's own exported reader (D-ARC3). */
async function readLedgerVouchers(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<CoverageVoucher[]> {
  const rows = await readVoucherNumbersWindow(admin, orgId, from, to);
  const out: CoverageVoucher[] = [];
  for (const r of rows) {
    // D-FIN7's one economic date, the same coalesce the reader filtered on — so a voucher lands in
    // the month every other financial surface shows it in.
    const dated = r.distribution_date ?? r.invoice_date;
    if (!r.invoice_number || !dated) continue;
    out.push({ invoiceNumber: r.invoice_number, month: String(dated).slice(0, 7), amount: Number(r.amount) });
  }
  return out;
}

/**
 * The `YYYY-MM` keys a half-open `[from, to)` window touches.
 *
 * Built by stepping the month number rather than by adding days to a `Date`, because a month is a
 * calendar step and not a fixed span — and the whole window is wall-clock by construction, so a
 * `Date` here would reintroduce the instant this stack spent a plan removing.
 */
export function monthsBetween(from: string, to: string): string[] {
  const [fy, fm] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  if (!fy || !fm || !ty || !tm) return [];
  // `to` is EXCLUSIVE, so its own month counts only when the window reaches into it — a window
  // ending on the 1st of September is an August window, and including September would hand the
  // bound an empty month and refuse the whole answer through `coverageIsPrintable`.
  const endsOnMonthStart = to.slice(8, 10) === "01";
  const last = (ty * 12 + tm) - (endsOnMonthStart ? 1 : 0);
  const out: string[] = [];
  for (let n = fy * 12 + fm; n <= last; n += 1) {
    out.push(`${Math.floor((n - 1) / 12)}-${String(((n - 1) % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

function nextMonthStart(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y! + 1}-01-01` : `${y}-${String(m! + 1).padStart(2, "0")}-01`;
}
