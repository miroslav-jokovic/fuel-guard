import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { ingestFuelTaxReceipts, readFuelTaxReceipts } from "./fuelTaxReceipts.js";

/**
 * McLeod's hand-keyed IFTA fuel receipts (0434): the landing and the one read the ifta module uses.
 * Fixtures are functions of the query — the recorder does not filter, so a flat array would prove
 * nothing about the window, the jurisdiction or the void filter.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const receipt = (over: Record<string, unknown> = {}) => ({
  external_id: "zz1", company_id: "TMS", tractor_unit: "512", jurisdiction: "UT",
  receipt_date: "2026-06-15", gallons: 109.084, processed_at: "2026-07-06T11:10:00Z", is_void: false, ...over,
});

describe("ingestFuelTaxReceipts", () => {
  it("upserts each receipt as a full row on (org_id, external_id), scoped to the org", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_fuel_tax_receipts: [] } });
    const r = await ingestFuelTaxReceipts(rec.client as unknown as SupabaseClient, ORG, {
      receipts: [receipt(), receipt({ external_id: "zz2", is_void: true })],
      window_start: "2024-10-06", window_end: "2026-10-06",
    });
    expect(r.received).toBe(2);
    expect(rec.writtenRows("mcleod_fuel_tax_receipts")).toEqual([
      { org_id: ORG, external_id: "zz1", company_id: "TMS", tractor_unit: "512", jurisdiction: "UT",
        receipt_date: "2026-06-15", gallons: 109.084, processed_at: "2026-07-06T11:10:00Z", is_void: false },
      { org_id: ORG, external_id: "zz2", company_id: "TMS", tractor_unit: "512", jurisdiction: "UT",
        receipt_date: "2026-06-15", gallons: 109.084, processed_at: "2026-07-06T11:10:00Z", is_void: true },
    ]);
    const write = rec.queries.find((q) => q.write?.method === "upsert")!;
    expect(write.ops.find((o) => o.method === "upsert")?.args[1]).toMatchObject({ onConflict: "org_id,external_id" });
    expectOrgScoped(rec, ORG);
  });
});

describe("readFuelTaxReceipts", () => {
  const STORED = [
    { external_id: "a", tractor_unit: "512", jurisdiction: "UT", receipt_date: "2026-06-15", gallons: "109.084", processed_at: null, is_void: false },
    { external_id: "b", tractor_unit: "512", jurisdiction: "TX", receipt_date: "2026-06-12", gallons: "112.134", processed_at: null, is_void: false },
    { external_id: "c", tractor_unit: "512", jurisdiction: "TX", receipt_date: "2026-06-12", gallons: "7.065", processed_at: null, is_void: true },
    { external_id: "d", tractor_unit: "512", jurisdiction: "TX", receipt_date: "2026-07-01", gallons: "50", processed_at: null, is_void: false },
  ];
  const filtersOf = (q: RecordedQuery) => q.ops.map((o) => [o.method, ...o.args] as unknown[]);
  const recorder = () => createSupabaseRecorder({
    tables: {
      mcleod_fuel_tax_receipts: (q) => {
        const ops = filtersOf(q);
        const arg = (m: string, c: string) => ops.find((o) => o[0] === m && o[1] === c)?.[2] as string | boolean | undefined;
        return STORED.filter((r) =>
          (arg("eq", "is_void") === undefined || r.is_void === arg("eq", "is_void")) &&
          r.receipt_date >= String(arg("gte", "receipt_date")) &&
          r.receipt_date < String(arg("lt", "receipt_date")) &&
          (arg("eq", "jurisdiction") === undefined || r.jurisdiction === arg("eq", "jurisdiction")));
      },
    },
  });

  it("returns the quarter's live receipts for one jurisdiction, voided ones never", async () => {
    const rec = recorder();
    const r = await readFuelTaxReceipts(rec.client as unknown as SupabaseClient, ORG, "2026-04-01", "2026-07-01", "TX");
    expect(r.map((x) => [x.externalId, x.gallons])).toEqual([["b", 112.134]]);
    expectOrgScoped(rec, ORG);
  });

  it("returns every jurisdiction when none is named, with the quarter's end exclusive", async () => {
    const rec = recorder();
    const r = await readFuelTaxReceipts(rec.client as unknown as SupabaseClient, ORG, "2026-04-01", "2026-07-01");
    expect(r.map((x) => x.externalId).sort()).toEqual(["a", "b"]);
  });
});
