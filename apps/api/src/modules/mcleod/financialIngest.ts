import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  TmsSettlementsPayload,
  TmsApVouchersPayload,
  TmsBillingPayload,
  TmsDeductionsPayload,
  TmsOfficeLinesPayload,
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
 * Settlements, deductions and movements arrive WITH their void state since D-FIN5 (the agent SQL
 * no longer filters `is_void` / `status = V`), so a row voided after its first sweep flips to void
 * on the next one. AP vouchers still arrive void-filtered until their staging table carries a
 * void column (F5b, FINANCE-GO-LIVE-PLAN §6).
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
      is_void: s.is_void ?? false,
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
      glid: d.glid ?? null,
      deduction_type: d.deduction_type ?? null,
      transacted_at: d.transacted_at ?? null,
      amount: d.amount,
      is_void: d.is_void ?? false,
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
      distance: b.distance ?? null,
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


/**
 * Office payroll lines (0276) — the one expense module with no subledger behind it.
 *
 * Every other module that posts payroll-shaped cost reaches the store through its own detail table:
 * SET and DRS through settlements and deductions, AP through vouchers carrying a vendor. OFF posts
 * STRAIGHT TO THE LEDGER, so the GL line IS the record and this is the only route it has.
 *
 * Upserted on the line's own `gl_ledger.id`, because the sweep re-reads a rolling window and would
 * otherwise stack a fresh copy of the same month's payroll on every pass.
 */
export async function ingestOfficeLines(
  admin: SupabaseClient,
  orgId: string,
  payload: TmsOfficeLinesPayload,
): Promise<FinancialIngestResult> {
  let upserted = 0;
  for (let i = 0; i < payload.lines.length; i += CHUNK) {
    const rows = payload.lines.slice(i, i + CHUNK).map((l) => ({
      org_id: orgId,
      external_id: l.external_id,
      payee_id: l.payee_id ?? null,
      glid: l.glid,
      descr: l.descr ?? null,
      amount: l.amount,
      transacted_at: l.transacted_at ?? null,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await admin
      .from("mcleod_office_lines")
      .upsert(rows, { onConflict: "org_id,external_id" });
    if (error) throw new Error(error.message);
    upserted += rows.length;
  }
  return { received: payload.lines.length, upserted };
}
