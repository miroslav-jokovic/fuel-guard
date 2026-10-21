import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TractorPeriod } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { ingestTractorPeriods, readTractorPeriods } from "./tractorPeriods.js";

/** McLeod's tractor service dates and owners (0510, TRUCK-DRIVER-PNL-PLAN P2): the landing and the read. */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const tractor = (tractor_id: string, over: Partial<TractorPeriod> = {}): TractorPeriod => ({
  tractor_id,
  company_id: "TMS",
  in_service_on: "2024-01-15",
  out_of_service_on: null,
  purchased_on: "2024-01-10",
  model_year: "2024",
  service_status: "A",
  tractor_status: "A",
  owner_id: "SILVMEIL",
  pay_owner: "D",
  ...over,
});

describe("ingestTractorPeriods", () => {
  it("upserts every tractor whole on (org, company, tractor), scoped to the org", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_tractor_periods: [] } });
    const r = await ingestTractorPeriods(rec.client as unknown as SupabaseClient, ORG, {
      tractors: [tractor("101"), tractor("102", { out_of_service_on: "2026-07-09", tractor_status: "I" })],
    });
    expect(r.received).toBe(2);
    const rows = rec.writtenRows("mcleod_tractor_periods");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ org_id: ORG, tractor_id: "102", out_of_service_on: "2026-07-09", tractor_status: "I", pay_owner: "D" });
    expect(typeof rows[0]!.swept_at).toBe("string");
    const write = rec.queries.find((q) => q.write?.method === "upsert")!;
    expect(write.ops.find((o) => o.method === "upsert")?.args[1]).toMatchObject({ onConflict: "org_id,company_id,tractor_id" });
    expectOrgScoped(rec, ORG);
  });

  it("writes a missing optional column as null rather than leaving it out of the row", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_tractor_periods: [] } });
    await ingestTractorPeriods(rec.client as unknown as SupabaseClient, ORG, {
      tractors: [{ tractor_id: "103", company_id: "TMS" }],
    });
    const [row] = rec.writtenRows("mcleod_tractor_periods");
    expect(row).toMatchObject({ in_service_on: null, out_of_service_on: null, purchased_on: null, model_year: null, pay_owner: null });
  });

  it("sends a large fleet in chunks of 500", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_tractor_periods: [] } });
    const tractors = Array.from({ length: 1201 }, (_, i) => tractor(String(i + 1)));
    const r = await ingestTractorPeriods(rec.client as unknown as SupabaseClient, ORG, { tractors });
    expect(rec.queries.filter((q) => q.write?.method === "upsert")).toHaveLength(3);
    expect(r.received).toBe(1201);
  });
});

describe("readTractorPeriods", () => {
  // A fixture that pages the way PostgREST does, so a reader that stopped after one page is visible.
  const pagedFixture = (rows: TractorPeriod[]) => (q: RecordedQuery) => {
    const range = q.ops.find((o) => o.method === "range");
    const [from, to] = range ? (range.args as [number, number]) : [0, rows.length - 1];
    return rows.slice(from, to + 1);
  };

  it("reads every page, past PostgREST's 1,000-row cap, org-scoped", async () => {
    const all = Array.from({ length: 1500 }, (_, i) => tractor(String(i + 1)));
    const rec = createSupabaseRecorder({ tables: { mcleod_tractor_periods: pagedFixture(all) } });
    const out = await readTractorPeriods(rec.client as unknown as SupabaseClient, ORG);
    expect(out).toHaveLength(1500);
    expect(rec.queries.filter((q) => q.table === "mcleod_tractor_periods")).toHaveLength(2);
    expectOrgScoped(rec, ORG);
  });

  it("orders the pages on the identity, so they are a total order", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_tractor_periods: pagedFixture([tractor("1")]) } });
    await readTractorPeriods(rec.client as unknown as SupabaseClient, ORG);
    const orders = rec.queries[0]!.ops.filter((o) => o.method === "order").map((o) => o.args[0]);
    expect(orders).toEqual(["company_id", "tractor_id"]);
  });
});
