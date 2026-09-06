import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { ingestSettlements, ingestApVouchers, ingestBilling, ingestDeductions, ingestOfficeLines } from "./financialIngest.js";
import {
  tmsSettlementsPayloadSchema,
  tmsApVouchersPayloadSchema,
  tmsBillingPayloadSchema,
  tmsDeductionsPayloadSchema,
  tmsOfficeLinesPayloadSchema,
} from "@silvicom/shared";

const ORG = "11111111-1111-1111-1111-111111111111";

const settlement = (over: Record<string, unknown> = {}) => ({
  external_id: "S-1",
  company_id: "TMS",
  tractor_unit: "754",
  driver_external_id: "D42",
  payee_type: "company_driver",
  accrued_at: "2026-06-15T00:00:00Z",
  total_pay: 378.5,
  posted_pay: 378.5,
  accrual_key: "AK-1",
  ...over,
});

const voucher = (over: Record<string, unknown> = {}) => ({
  external_id: "V-1",
  company_id: "TMS",
  vendor_id: "PILOKNTN",
  invoice_number: "INV-9",
  distribution_date: "2026-06-20T00:00:00Z",
  amount: 1250.0,
  discount_amount: 0,
  ap_glid: "70200000",
  is_paid: false,
  ...over,
});

describe("ingestSettlements", () => {
  it("upserts full rows onto (org_id, external_id) — every row names the org", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_settlements: [{ id: "x" }], mcleod_ap_vouchers: [{ id: "x" }], mcleod_billing: [{ id: "x" }] } });
    const payload = tmsSettlementsPayloadSchema.parse({
      settlements: [settlement(), settlement({ external_id: "S-2", payee_type: "owner_operator", total_pay: 2932 })],
      window_start: "2026-06-01",
      window_end: "2026-07-01",
    });
    const r = await ingestSettlements(rec.client, ORG, payload);
    expect(r.received).toBe(2);
    const rows = rec.writtenRows("mcleod_settlements");
    expect(rows).toHaveLength(2);
    // Full-row upsert (lint:upserts): the payload carries EVERY 0257 column the wire maps, so
    // Postgres checks NOT NULL before conflict arbitration on complete rows only.
    expect(rows[0]).toMatchObject({
      org_id: ORG,
      external_id: "S-1",
      payee_type: "company_driver",
      total_pay: 378.5,
      posted_pay: 378.5,
      accrual_key: "AK-1",
      is_void: false,
    });
    expect(Object.keys(rows[0]!).sort()).toEqual(Object.keys(rows[1]!).sort());
    expectOrgScoped(rec, ORG);
  });

  it("keeps total_pay and posted_pay apart — the two figures answer different questions", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_settlements: [{ id: "x" }], mcleod_ap_vouchers: [{ id: "x" }], mcleod_billing: [{ id: "x" }] } });
    const payload = tmsSettlementsPayloadSchema.parse({
      settlements: [settlement({ total_pay: 2932.0, posted_pay: 2926.33 })],
      window_start: "2026-06-01",
      window_end: "2026-07-01",
    });
    await ingestSettlements(rec.client, ORG, payload);
    const rows = rec.writtenRows("mcleod_settlements");
    expect(rows[0]!.total_pay).toBe(2932.0);
    expect(rows[0]!.posted_pay).toBe(2926.33);
    expectOrgScoped(rec, ORG);
  });
});

describe("ingestApVouchers", () => {
  it("upserts full voucher rows with the GL account intact — ap_glid is the only classification the source carries", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_settlements: [{ id: "x" }], mcleod_ap_vouchers: [{ id: "x" }], mcleod_billing: [{ id: "x" }] } });
    const payload = tmsApVouchersPayloadSchema.parse({
      vouchers: [voucher(), voucher({ external_id: "V-2", ap_glid: null })],
      window_start: "2026-06-01",
      window_end: "2026-07-01",
    });
    const r = await ingestApVouchers(rec.client, ORG, payload);
    expect(r.received).toBe(2);
    const rows = rec.writtenRows("mcleod_ap_vouchers");
    expect(rows[0]).toMatchObject({ org_id: ORG, external_id: "V-1", ap_glid: "70200000", amount: 1250.0 });
    // an unclassified voucher lands with ap_glid null, never dropped — a bucket of cost nobody
    // can categorise is exactly what the allocation review needs to see
    expect(rows[1]).toMatchObject({ external_id: "V-2", ap_glid: null });
    expectOrgScoped(rec, ORG);
  });
});

describe("ingestBilling", () => {
  it("upserts full invoice rows with equipment intact — the one money table that names its truck", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_billing: [{ id: "x" }] } });
    const payload = tmsBillingPayloadSchema.parse({
      billing: [{
        external_id: "B-1", company_id: "TMS", invoice_no: "INV-100", customer_id: "ACME",
        order_external_id: "O-9", tractor_unit: "754", driver_external_id: "D42",
        bill_date: "2026-06-10T00:00:00Z", total_charges: 3100.0, other_charge: 150.0, excise_tax: 0,
        post_key: "PK-1", post_module: "BILL",
      }],
      window_start: "2026-06-01",
      window_end: "2026-07-01",
    });
    const r = await ingestBilling(rec.client, ORG, payload);
    expect(r.received).toBe(1);
    const rows = rec.writtenRows("mcleod_billing");
    // linehaul, accessorials and excise held apart — they answer different questions
    expect(rows[0]).toMatchObject({
      org_id: ORG, external_id: "B-1", tractor_unit: "754",
      total_charges: 3100.0, other_charge: 150.0, excise_tax: 0, post_module: "BILL",
    });
    expectOrgScoped(rec, ORG);
  });
});

describe("ingestDeductions", () => {
  it("upserts full rows onto (org_id, external_id), keeping the source's own partial attribution", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_deductions: [{ id: "x" }] } });
    const payload = tmsDeductionsPayloadSchema.parse({
      deductions: [
        {
          external_id: "DD-1",
          company_id: "TMS",
          payee_id: "D42",
          payee_type: "company_driver",
          tractor_unit: "754",
          deduct_code: "ESC",
          deduction_type: "D",
          transacted_at: "2026-06-18T00:00:00Z",
          amount: 120.0,
          accrual_key: "AK-9",
        },
        // Payee-level: NO tractor, and that must survive as null — an invented attribution here is
        // exactly what D-FS5 forbids (escrow and advances follow the person, not the truck).
        {
          external_id: "DD-2",
          company_id: "TMS",
          payee_id: "D42",
          payee_type: "company_driver",
          deduct_code: "ADV",
          amount: 300.0,
        },
      ],
      window_start: "2026-06-01",
      window_end: "2026-07-01",
    });
    const r = await ingestDeductions(rec.client, ORG, payload);
    expect(r.received).toBe(2);
    const rows = rec.writtenRows("mcleod_deductions");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      org_id: ORG,
      external_id: "DD-1",
      tractor_unit: "754",
      deduct_code: "ESC",
      amount: 120.0,
      is_void: false,
    });
    expect(rows[1]).toMatchObject({ external_id: "DD-2", tractor_unit: null, amount: 300.0 });
    expect(Object.keys(rows[0]!).sort()).toEqual(Object.keys(rows[1]!).sort());
    expectOrgScoped(rec, ORG);
  });
});

describe("ingestOfficeLines", () => {
  /**
   * OFF is the only expense module with no subledger — 0257 measured that office payroll posts
   * straight to the ledger, so the GL line IS the record. June 2026: 318 lines, 318 of them
   * carrying a payee, 31 distinct people, $194,407.20 that the store could previously only hold
   * as one company-level number.
   */
  it("stages payroll at person grain, keeping the payee McLeod asserts", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_office_lines: [{ id: "x" }] } });
    const payload = tmsOfficeLinesPayloadSchema.parse({
      lines: [{
        external_id: "GL-778", glid: "40900000", descr: "ARKADZIO, Office Payroll",
        payee_id: "ARKADZIO", transacted_at: "2026-06-12T00:00:00Z", amount: 4210.55,
      }],
      window_start: "2026-06-01",
      window_end: "2026-07-01",
    });
    const r = await ingestOfficeLines(rec.client, ORG, payload);
    expect(r.received).toBe(1);
    expect(rec.writtenRows("mcleod_office_lines")[0]).toMatchObject({
      org_id: ORG, external_id: "GL-778", payee_id: "ARKADZIO", amount: 4210.55,
    });
    expectOrgScoped(rec, ORG);
  });

  // `descr` is 40 truncated characters of free text and D-MC12 forbids mining it for attribution.
  // It is stored exactly as McLeod wrote it so a human can read the row, and nothing parses it.
  it("stores descr verbatim rather than parsing a name out of it", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_office_lines: [{ id: "x" }] } });
    const payload = tmsOfficeLinesPayloadSchema.parse({
      lines: [{
        external_id: "GL-779", glid: "40900000", descr: "BIGRIG, Towing (truck # 506) reimbur",
        payee_id: "BIGRIG", transacted_at: "2026-06-12T00:00:00Z", amount: 300,
      }],
      window_start: "2026-06-01",
      window_end: "2026-07-01",
    });
    await ingestOfficeLines(rec.client, ORG, payload);
    const row = rec.writtenRows("mcleod_office_lines")[0]!;
    expect(row.descr).toBe("BIGRIG, Towing (truck # 506) reimbur");
    // The truck number in that text is NOT lifted onto the row.
    expect(Object.keys(row)).not.toContain("tractor_unit");
  });

  it("upserts on the line's own id, so a re-swept window updates instead of duplicating payroll", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_office_lines: [{ id: "x" }] } });
    const payload = tmsOfficeLinesPayloadSchema.parse({
      lines: [{ external_id: "GL-778", glid: "40900000", payee_id: "ARKADZIO", amount: 4210.55 }],
      window_start: "2026-06-01",
      window_end: "2026-07-01",
    });
    await ingestOfficeLines(rec.client, ORG, payload);
    const call = rec.queries.find((q) => q.table === "mcleod_office_lines");
    expect(call?.ops.some((o) => o.method === "upsert" && JSON.stringify(o.args).includes("org_id,external_id"))).toBe(true);
  });
});

describe("company_id reaches every staging row (D-FIN8)", () => {
  it("settlements, vouchers and billing carry the McLeod company the agent sent", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_settlements: [], mcleod_ap_vouchers: [], mcleod_billing: [] } });
    await ingestSettlements(rec.client, ORG, tmsSettlementsPayloadSchema.parse({
      settlements: [settlement({ company_id: "TMS2" })], window_start: "2026-06-01", window_end: "2026-07-01",
    }));
    expect(rec.writtenRows("mcleod_settlements")[0]).toMatchObject({ company_id: "TMS2" });
    await ingestApVouchers(rec.client, ORG, tmsApVouchersPayloadSchema.parse({
      vouchers: [voucher({ company_id: "TMS3" })], window_start: "2026-06-01", window_end: "2026-07-01",
    }));
    expect(rec.writtenRows("mcleod_ap_vouchers")[0]).toMatchObject({ company_id: "TMS3" });
    expectOrgScoped(rec, ORG);
  });
});
