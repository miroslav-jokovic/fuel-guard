import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { ingestSettlements, ingestApVouchers } from "./financialIngest.js";
import { tmsSettlementsPayloadSchema, tmsApVouchersPayloadSchema } from "@silvicom/shared";

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
    const rec = createSupabaseRecorder({ tables: { mcleod_settlements: [{ id: "x" }], mcleod_ap_vouchers: [{ id: "x" }] } });
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
    const rec = createSupabaseRecorder({ tables: { mcleod_settlements: [{ id: "x" }], mcleod_ap_vouchers: [{ id: "x" }] } });
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
    const rec = createSupabaseRecorder({ tables: { mcleod_settlements: [{ id: "x" }], mcleod_ap_vouchers: [{ id: "x" }] } });
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
