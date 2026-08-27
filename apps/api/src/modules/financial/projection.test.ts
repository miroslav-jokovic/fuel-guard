import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { projectFinancialWindow } from "./projection.js";

const ORG = "11111111-1111-1111-1111-111111111111";
const FROM = "2026-06-01";
const TO = "2026-07-01";

const seed = () =>
  createSupabaseRecorder({
    tables: {
      vehicles: [{ id: "veh-754", unit_number: "754" }],
      drivers: [{ id: "drv-42", mcleod_driver_id: "D42" }],
      mcleod_settlements: [
        {
          id: "row-s1", external_id: "S-1", tractor_unit: "754", driver_external_id: "D42",
          payee_type: "company_driver", accrued_at: "2026-06-15T00:00:00Z", paid_at: "2026-06-20T00:00:00Z",
          total_pay: 378.5, is_void: false, accrual_key: "AK-1",
        },
        {
          id: "row-s2", external_id: "S-2", tractor_unit: "UNKNOWN-UNIT", driver_external_id: null,
          payee_type: "owner_operator", accrued_at: "2026-06-16T00:00:00Z", paid_at: null,
          total_pay: 2932, is_void: false, accrual_key: "AK-2",
        },
      ],
      mcleod_ap_vouchers: [
        {
          id: "row-v1", external_id: "V-FUEL", vendor_id: "PILOKNTN", invoice_date: "2026-06-10T00:00:00Z",
          distribution_date: "2026-06-12T00:00:00Z", amount: 1017601.81, ap_glid: "20550000",
          is_paid: true, check_number: null, post_key: "PK-F", post_module: "AP",
        },
        {
          id: "row-v2", external_id: "V-INS", vendor_id: "ACMEINS", invoice_date: "2026-06-05T00:00:00Z",
          distribution_date: "2026-06-06T00:00:00Z", amount: 4200, ap_glid: "70300000",
          is_paid: false, check_number: null, post_key: "PK-I", post_module: "AP",
        },
      ],
      mcleod_billing: [
        {
          id: "row-b1", external_id: "B-1", order_external_id: "O-9", tractor_unit: "754",
          driver_external_id: "D42", bill_date: "2026-06-10T00:00:00Z", transfer_date: null,
          total_charges: 3100, other_charge: 150, post_key: "PK-B", post_module: "BILL",
        },
      ],
      fuel_transactions: [
        { id: "ft-1", external_ref: "EFS-1", fueled_at: "2026-06-11T08:00:00Z", total_cost: 512.4, vehicle_id: "veh-754", driver_id: "drv-42", is_canonical: true },
        { id: "ft-2", external_ref: "EFS-2", fueled_at: "2026-06-12T08:00:00Z", total_cost: null, vehicle_id: "veh-754", driver_id: null, is_canonical: true },
        { id: "ft-3", external_ref: "EFS-3", fueled_at: "2026-06-13T08:00:00Z", total_cost: 100, vehicle_id: null, driver_id: null, is_canonical: false },
      ],
      financial_entries: [{ id: "fe" }],
    },
  });

describe("projectFinancialWindow", () => {
  it("projects every domain with the dedup rules the reports depend on", async () => {
    const rec = seed();
    const r = await projectFinancialWindow(rec.client, ORG, FROM, TO);
    expect(r).toMatchObject({ settlements: 2, vouchers: 2, billing: 1, fuelFills: 1, skippedFuelNoCost: 1 });

    const rows = rec.writtenRows("financial_entries") as Record<string, unknown>[];
    const by = (ext: string) => rows.find((e) => e.external_id === ext)!;

    // settlements: payee split (D-MC13), accrual lifecycle, resolved attribution, SET ledger key
    expect(by("S-1")).toMatchObject({
      direction: "expense", category: "driver_pay", amount: 378.5, lifecycle_stage: "accrual",
      vehicle_id: "veh-754", driver_id: "drv-42", dedup_key: "set:S-1", is_canonical: true,
      ledger_post_key: "AK-1", ledger_module: "SET", source: "mcleod",
    });
    // an unknown unit stays null — attribution is the source's, never a guess (D-FS5)
    expect(by("S-2")).toMatchObject({ category: "contractor_pay", vehicle_id: null, driver_id: null });

    // D-FS2: the fuel-vendor AP invoice is category fuel and NON-canonical — the $1,017,601.81
    // that EFS already carries per fill can never be counted twice by a canonical-predicate report
    expect(by("V-FUEL")).toMatchObject({ category: "fuel", is_canonical: false, amount: 1017601.81 });
    // an ordinary voucher is canonical ap_expense with its GL account riding along (D-FS5)
    expect(by("V-INS")).toMatchObject({ category: "ap_expense", is_canonical: true, ledger_account: "70300000" });

    // billing splits linehaul from accessorial — two entries, distinct dedup keys, both canonical
    expect(by("B-1")).toMatchObject({ direction: "earning", category: "linehaul_revenue", amount: 3100, dedup_key: "bill:B-1" });
    expect(by("B-1:acc")).toMatchObject({ category: "accessorial_revenue", amount: 150, dedup_key: "bill:B-1:acc" });

    // EFS fills: canonical fuel; the costless fill is SKIPPED and counted; the non-canonical twin never projects
    expect(by("EFS-1")).toMatchObject({ source: "efs", category: "fuel", amount: 512.4, dedup_key: "fuel:efs:EFS-1", is_canonical: true });
    expect(rows.find((e) => e.external_id === "EFS-2")).toBeUndefined();
    expect(rows.find((e) => e.external_id === "EFS-3")).toBeUndefined();

    // D-FS4: every amount positive, direction carries the meaning
    for (const e of rows) expect(Number(e.amount)).toBeGreaterThanOrEqual(0);

    expectOrgScoped(rec, ORG);
  });

  it("is idempotent by construction: the upsert targets the 0257 source-row identity", async () => {
    const rec = seed();
    await projectFinancialWindow(rec.client, ORG, FROM, TO);
    const write = rec.queries.find((q) => q.table === "financial_entries" && q.write);
    expect(write?.write?.method).toBe("upsert");
    // every projected row names the org — the service role bypasses RLS, this is the wall
    const rows = rec.writtenRows("financial_entries") as Record<string, unknown>[];
    for (const e of rows) expect(e.org_id).toBe(ORG);
  });
});
