import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { quarterWindow, readIftaPeriodReceipts } from "./receiptReads.js";

/**
 * The IFTA ledger's half of McLeod's hand-keyed receipts (IP6): read through mcleod's door, mapped to
 * our trucks, card duplicates dropped, summed per state. Fixtures are functions of the query — the
 * recorder does not filter, so a flat array would prove nothing about the window or the mapping.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const VEHICLES = [
  { id: "v512", unit_number: "512", mcleod_tractor_id: "512" },
  // Never linked by the roster sweep: found by its painted unit number.
  { id: "v732", unit_number: "732", mcleod_tractor_id: null },
  // Linked under a McLeod id that is not its unit number: the link column wins.
  { id: "v900", unit_number: "900", mcleod_tractor_id: "T900" },
  { id: "v101", unit_number: "101", mcleod_tractor_id: "101" },
];

const receipt = (external_id: string, tractor_unit: string, jurisdiction: string, receipt_date: string, gallons: number) => ({
  external_id, tractor_unit, jurisdiction, receipt_date, gallons: String(gallons), processed_at: null, is_void: false,
});
const RECEIPTS = [
  receipt("r1", "512", "TX", "2026-07-10", 100),
  // The card already imported this fill: same truck, state, day, 0.3 gal apart — counted once.
  receipt("r2", "732", "TX", "2026-08-02", 80.3),
  // Same truck and day, another state: a second fill, not a duplicate.
  receipt("r3", "732", "OK", "2026-08-02", 80),
  // A McLeod unit we do not have: counted in its state, named, never dropped.
  receipt("r4", "999", "TX", "2026-08-05", 40),
  receipt("r5", "T900", "NM", "2026-09-01", 60),
  // The next quarter's first day.
  receipt("r6", "512", "TX", "2026-10-01", 999),
];

const FILLS = [
  { id: "f2", vehicle_id: "v732", state: "TX", business_date: "2026-08-02", gallons: "80" },
  // Same day and gallons as r1 but on ANOTHER truck — must not swallow 512's receipt.
  { id: "f1", vehicle_id: "v101", state: "TX", business_date: "2026-07-10", gallons: "100" },
];

const opsOf = (q: RecordedQuery) => q.ops.map((o) => [o.method, ...o.args] as unknown[]);
const arg = (q: RecordedQuery, m: string, c: string) => opsOf(q).find((o) => o[0] === m && o[1] === c)?.[2];

function recorder(receipts = RECEIPTS) {
  return createSupabaseRecorder({
    tables: {
      mcleod_fuel_tax_receipts: (q) =>
        receipts.filter((r) =>
          r.receipt_date >= String(arg(q, "gte", "receipt_date")) && r.receipt_date < String(arg(q, "lt", "receipt_date"))),
      vehicles: (q) => {
        const linked = arg(q, "in", "mcleod_tractor_id") as string[] | undefined;
        const units = arg(q, "in", "unit_number") as string[] | undefined;
        return VEHICLES.filter((v) =>
          (linked && v.mcleod_tractor_id != null && linked.includes(v.mcleod_tractor_id)) ||
          (units && units.includes(v.unit_number)));
      },
      fuel_transactions: (q) => {
        const ids = arg(q, "in", "vehicle_id") as string[];
        return FILLS.filter((f) => ids.includes(f.vehicle_id) &&
          f.business_date >= String(arg(q, "gte", "business_date")) && f.business_date < String(arg(q, "lt", "business_date")));
      },
    },
  });
}

describe("readIftaPeriodReceipts", () => {
  it("sums the quarter's receipts per state, dropping the one a card fill already carries", async () => {
    const rec = recorder();
    const r = await readIftaPeriodReceipts(rec.client as unknown as SupabaseClient, ORG, 2026, 3);
    expect(r.jurisdictions).toEqual([
      { jurisdiction: "NM", gallons: 60, receipts: 1 },
      { jurisdiction: "OK", gallons: 80, receipts: 1 },
      { jurisdiction: "TX", gallons: 140, receipts: 2 },
    ]);
    expect(r).toMatchObject({ duplicatesDropped: 1, duplicateGallons: 80.3, unmatched: 1, unmatchedUnits: ["999"] });
  });

  it("checks duplicates only against the fills of trucks that have a receipt, inside the quarter", async () => {
    const rec = recorder();
    await readIftaPeriodReceipts(rec.client as unknown as SupabaseClient, ORG, 2026, 3);
    const fuel = rec.queries.find((q) => q.table === "fuel_transactions")!;
    expect((arg(fuel, "in", "vehicle_id") as string[]).sort()).toEqual(["v512", "v732", "v900"]);
    expect(arg(fuel, "gte", "business_date")).toBe("2026-07-01");
    expect(arg(fuel, "lt", "business_date")).toBe("2026-10-01");
  });

  it("scopes every read to the org — the service role bypasses RLS", async () => {
    const rec = recorder();
    await readIftaPeriodReceipts(rec.client as unknown as SupabaseClient, ORG, 2026, 3);
    expectOrgScoped(rec, ORG);
  });

  it("reads as card fills only, touching nothing else, when McLeod has no receipts yet", async () => {
    const rec = recorder([]);
    const r = await readIftaPeriodReceipts(rec.client as unknown as SupabaseClient, ORG, 2026, 3);
    expect(r).toEqual({ jurisdictions: [], duplicatesDropped: 0, duplicateGallons: 0, unmatched: 0, unmatchedUnits: [] });
    expect(rec.queries.map((q) => q.table)).toEqual(["mcleod_fuel_tax_receipts"]);
  });
});

describe("quarterWindow", () => {
  it("cuts a quarter as [first day, next quarter's first day)", () => {
    expect(quarterWindow(2026, 3)).toEqual({ fromDay: "2026-07-01", toDayExclusive: "2026-10-01" });
    expect(quarterWindow(2026, 4)).toEqual({ fromDay: "2026-10-01", toDayExclusive: "2027-01-01" });
  });
});
