import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  TmsSettlementsPayload,
  TmsApVouchersPayload,
  TmsBillingPayload,
  TmsDeductionsPayload,
} from "@silvicom/shared";

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
 * Deductions gained their staging table in 0268 (they shipped without one in 0257, and this
 * header said so honestly until the table existed) — `ingestDeductions` below is the landing.
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

export async function ingestDeductions(
  admin: SupabaseClient,
  orgId: string,
  payload: TmsDeductionsPayload,
): Promise<FinancialIngestResult> {
  let upserted = 0;
  for (let i = 0; i < payload.deductions.length; i += CHUNK) {
    const rows = payload.deductions.slice(i, i + CHUNK).map((d) => ({
      org_id: orgId,
      external_id: d.external_id,
      payee_id: d.payee_id ?? null,
      payee_type: d.payee_type,
      // NULL is the source's own statement — 317 of June's 699 type-'D' rows carry a tractor and
      // the rest follow the person; the harness's allocation rules interpret that, never the ingest.
      tractor_unit: d.tractor_unit ?? null,
      deduct_code: d.deduct_code ?? null,
      deduction_type: d.deduction_type ?? null,
      transacted_at: d.transacted_at ?? null,
      amount: d.amount,
      is_void: false,
      accrual_key: d.accrual_key ?? null,
    }));
    const { data, error } = await admin
      .from("mcleod_deductions")
      .upsert(rows, { onConflict: "org_id,external_id" })
      .select("id");
    if (error) throw new Error(`mcleod_deductions upsert failed: ${error.message}`);
    upserted += data?.length ?? rows.length;
  }
  return { received: payload.deductions.length, upserted };
}

export async function ingestBilling(
  admin: SupabaseClient,
  orgId: string,
  payload: TmsBillingPayload,
): Promise<FinancialIngestResult> {
  let upserted = 0;
  for (let i = 0; i < payload.billing.length; i += CHUNK) {
    const rows = payload.billing.slice(i, i + CHUNK).map((b) => ({
      org_id: orgId,
      external_id: b.external_id,
      invoice_no: b.invoice_no ?? null,
      customer_id: b.customer_id ?? null,
      order_external_id: b.order_external_id ?? null,
      master_order_id: b.master_order_id ?? null,
      tractor_unit: b.tractor_unit ?? null,
      trailer_unit: b.trailer_unit ?? null,
      driver_external_id: b.driver_external_id ?? null,
      dispatcher_user_id: b.dispatcher_user_id ?? null,
      dispatcher_name: b.dispatcher_name ?? null,
      bill_date: b.bill_date ?? null,
      ship_date: b.ship_date ?? null,
      delivery_date: b.delivery_date ?? null,
      transfer_date: b.transfer_date ?? null,
      total_charges: b.total_charges,
      other_charge: b.other_charge,
      excise_tax: b.excise_tax,
      canceled: b.canceled ?? null,
      rebilled: b.rebilled ?? null,
      billing_loaded_distance: b.billing_loaded_distance ?? null,
      billing_empty_distance: b.billing_empty_distance ?? null,
      post_key: b.post_key ?? null,
      post_module: b.post_module ?? null,
    }));
    const { data, error } = await admin
      .from("mcleod_billing")
      .upsert(rows, { onConflict: "org_id,external_id" })
      .select("id");
    if (error) throw new Error(`mcleod_billing upsert failed: ${error.message}`);
    upserted += data?.length ?? rows.length;
  }
  return { received: payload.billing.length, upserted };
}
