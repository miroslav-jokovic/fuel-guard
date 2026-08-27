import type { SupabaseClient } from "@supabase/supabase-js";
import type { TmsSettlementsPayload, TmsApVouchersPayload } from "@silvicom/shared";

/**
 * The financial staging ingest — settlements and AP vouchers land in their 0257 detail tables
 * (program step P3.2, docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md; FINANCIAL-STORE-PLAN
 * §5.1). These two upserts are what turn the agent's print-only reconciliation sweeps into a
 * pipeline, and what let `check-table-producers.mjs` retire two of 0257's four waivers.
 *
 * Idempotent on (org_id, external_id) — the McLeod row id — so a re-swept window converges
 * instead of duplicating; the agent's rolling window plus posting lag makes overlap the normal
 * case, not the exception. Full-row upserts (the lint:upserts rule): a swept row REPLACES the
 * stored row wholesale, because McLeod is the source of truth for its own staging table.
 *
 * ⚠ Void-after-sweep is invisible by design, for now: the extraction excludes voided rows
 * (`is_void = 'N'` / `void_date IS NULL` in the agent's SQL — D-MC18, a voided trip's miles
 * were never run), so a row voided AFTER a sweep simply stops re-appearing and its stored copy
 * stays `is_void = false`. The dedicated void-sweep is named follow-up work in the program
 * plan; until it lands, reports built on these tables inherit McLeod's own void lag.
 *
 * Deductions (tmsDeductionFactSchema) have NO staging table yet — 0257 shipped without one —
 * so they are deliberately not accepted here; landing them straight into financial_entries is
 * P3.4's projection decision, not a staging shortcut.
 */

const CHUNK = 500;

export interface FinancialIngestResult {
  received: number;
  upserted: number;
}

export async function ingestSettlements(
  admin: SupabaseClient,
  orgId: string,
  payload: TmsSettlementsPayload,
): Promise<FinancialIngestResult> {
  let upserted = 0;
  for (let i = 0; i < payload.settlements.length; i += CHUNK) {
    const rows = payload.settlements.slice(i, i + CHUNK).map((s) => ({
      org_id: orgId,
      external_id: s.external_id,
      tractor_unit: s.tractor_unit ?? null,
      trailer_unit: s.trailer_unit ?? null,
      driver_external_id: s.driver_external_id ?? null,
      movement_external_id: s.movement_external_id ?? null,
      order_external_id: s.order_external_id ?? null,
      payee_id: s.payee_id ?? null,
      payee_type: s.payee_type,
      pay_method: s.pay_method ?? null,
      accrued_at: s.accrued_at ?? null,
      paid_at: s.paid_at ?? null,
      transferred_at: s.transferred_at ?? null,
      total_pay: s.total_pay,
      posted_pay: s.posted_pay,
      pay_distance: s.pay_distance ?? null,
      is_void: false,
      accrual_key: s.accrual_key ?? null,
      post_key: s.post_key ?? null,
    }));
    const { data, error } = await admin
      .from("mcleod_settlements")
      .upsert(rows, { onConflict: "org_id,external_id" })
      .select("id");
    if (error) throw new Error(`mcleod_settlements upsert failed: ${error.message}`);
    upserted += data?.length ?? rows.length;
  }
  return { received: payload.settlements.length, upserted };
}

export async function ingestApVouchers(
  admin: SupabaseClient,
  orgId: string,
  payload: TmsApVouchersPayload,
): Promise<FinancialIngestResult> {
  let upserted = 0;
  for (let i = 0; i < payload.vouchers.length; i += CHUNK) {
    const rows = payload.vouchers.slice(i, i + CHUNK).map((v) => ({
      org_id: orgId,
      external_id: v.external_id,
      voucher_no: v.voucher_no ?? null,
      voucher_type: v.voucher_type ?? null,
      vendor_id: v.vendor_id ?? null,
      invoice_number: v.invoice_number ?? null,
      purchase_order_no: v.purchase_order_no ?? null,
      description: v.description ?? null,
      invoice_date: v.invoice_date ?? null,
      due_date: v.due_date ?? null,
      distribution_date: v.distribution_date ?? null,
      amount: v.amount,
      discount_amount: v.discount_amount,
      ap_glid: v.ap_glid ?? null,
      is_paid: v.is_paid,
      check_number: v.check_number ?? null,
      post_key: v.post_key ?? null,
      post_module: v.post_module ?? null,
    }));
    const { data, error } = await admin
      .from("mcleod_ap_vouchers")
      .upsert(rows, { onConflict: "org_id,external_id" })
      .select("id");
    if (error) throw new Error(`mcleod_ap_vouchers upsert failed: ${error.message}`);
    upserted += data?.length ?? rows.length;
  }
  return { received: payload.vouchers.length, upserted };
}
