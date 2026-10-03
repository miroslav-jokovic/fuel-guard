import { describe, it, expect } from "vitest";
import { readFuelOpportunities } from "./findingsOpportunities.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";

/**
 * The savings strip's read (FS-STRIP). The ranking is `summariseOpportunities`, tested in shared; what
 * only a test here can pin is that the read is the inbox's own population, and that
 * it goes past PostgREST's 1,000-row cap.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const ex = (o: Record<string, unknown> = {}) => ({ kind: "contract_variance", amount: "20.00", occurred_on: "2026-09-20", ...o });

const seed = (o: { exceptions?: unknown[] | ((q: RecordedQuery) => unknown[]); vehicles?: unknown[] } = {}) =>
  createSupabaseRecorder({
    tables: { fuel_exceptions: o.exceptions ?? [ex()], vehicles: o.vehicles ?? [] },
  });

describe("readFuelOpportunities", () => {
  it("gives one row per kind, and an empty list when the ledger is clear", async () => {
    const rows = await readFuelOpportunities(seed({ exceptions: [ex(), ex({ amount: "5.00" })] }).client, ORG);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ kind: "contract_variance", count: 2, amount: 25 });
    expect(await readFuelOpportunities(seed({ exceptions: [] }).client, ORG)).toEqual([]);
  });

  it("reads only open findings for one organization, in the window it was asked about", async () => {
    const rec = seed();
    await readFuelOpportunities(rec.client, ORG, { from: "2026-09-01", to: "2026-09-30" });
    expectOrgScoped(rec, ORG);
    const f = rec.forTable("fuel_exceptions")[0]!.filters();
    expect(f.some((x) => x.col === "status" && Array.isArray(x.val) && !x.val.includes("credited") && !x.val.includes("dismissed"))).toBe(true);
    expect(f.some((x) => x.col === "occurred_on" && x.val === "2026-09-01")).toBe(true);
    expect(f.some((x) => x.col === "occurred_on" && x.val === "2026-09-30")).toBe(true);
  });

  it("narrows to the picked trucks by unit number, and to nothing when they match no vehicle", async () => {
    const rec = seed({ vehicles: [{ id: "v1", unit_number: "701" }] });
    await readFuelOpportunities(rec.client, ORG, { vehicleIds: ["v1"] });
    expect(rec.forTable("fuel_exceptions")[0]!.filters().some((x) => x.col === "unit_number" && Array.isArray(x.val) && x.val.includes("701"))).toBe(true);

    const none = seed({ vehicles: [] });
    expect(await readFuelOpportunities(none.client, ORG, { vehicleIds: ["ghost"] })).toEqual([]);
    expect(none.forTable("fuel_exceptions")).toHaveLength(0);
  });

  it("reads past one page, so a count is never a cap", async () => {
    const page = (n: number) => Array.from({ length: n }, () => ex({ amount: "1.00" }));
    // A full page of 1,000 says "there may be more"; the short page after it ends the read.
    const rec = createSupabaseRecorder({ tables: { fuel_exceptions: { pages: [page(1000), page(10)] } } });
    const rows = await readFuelOpportunities(rec.client, ORG);
    expect(rows![0]).toMatchObject({ count: 1010, amount: 1010 });
    expect(rec.forTable("fuel_exceptions")).toHaveLength(2);
  });
});
