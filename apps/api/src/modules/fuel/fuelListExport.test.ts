import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { MAX_EXPORT_ROWS } from "../../lib/csvExport.js";
import { exportDeclines, exportFills, fillFiltersFromQuery } from "./fuelListExport.js";

/**
 * The Fuel Log's exports (FUEL-P2, D-FUI15).
 *
 * ── WHAT IS ACTUALLY AT RISK HERE ───────────────────────────────────────────────────────────────
 * Not the CSV syntax — that is `csvCell` in `@silvicom/shared`, tested there. Four things can be
 * silently wrong in a way a reader would never see:
 *
 *   1. THE FILE DESCRIBES A DIFFERENT SET THAN THE SCREEN. The whole point of D-FUI15 is that the
 *      export applies the filters the page applied, so the assertions below are about the QUERY, not
 *      about the bytes: the truck list, the window, the search, and the canonical-only predicate that
 *      makes a row a fill rather than a duplicate.
 *   2. IT TRUNCATES. PostgREST answers 1,000 rows whatever is asked for, so an export that forgot to
 *      page would produce a plausible file missing everything after the first thousand. There is no
 *      symptom: a spreadsheet with no last row looks complete.
 *   3. IT CROSSES A TENANT. `admin` is the service role and bypasses RLS, so the `.eq("org_id", …)` is
 *      the only boundary. `expectOrgScoped` is the assertion that closes it.
 *   4. IT LOSES THE SCOPE. A file outlives its download; without the first line, "is this all of
 *      August or only the two trucks" is unanswerable from the file itself.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const V1 = "11111111-2222-4333-8444-555555555555";
const V2 = "22222222-3333-4444-8555-666666666666";
const D1 = "33333333-4444-4555-8666-777777777777";

const SCOPE = { title: "Fuel log — fills", from: "2026-08-01", to: "2026-08-31", trucks: 0, generatedAt: "2026-09-04T12:00:00.000Z" };

const fill = (over: Record<string, unknown> = {}) => ({
  id: "f1", vehicle_id: V1, driver_id: D1, fueled_at: "2026-08-15T14:00:00Z", business_date: "2026-08-15",
  odometer: 100_000, miles_since_last: 620, gallons: 98.4, price_per_gal: 3.499, total_cost: 344.29,
  location_text: "Pilot 412", state: "TX", computed_mpg: 6.3, has_anomaly: false, max_severity: null,
  ai_risk_level: null, samsara_location_confidence: null, tank_type: "tractor", case_level: "clear",
  ...over,
});

const rosters = {
  vehicles: [{ id: V1, unit_number: "654" }, { id: V2, unit_number: "655" }],
  drivers: [{ id: D1, full_name: "A Driver" }],
};

const seed = (fills: unknown[] = [fill()]) =>
  createSupabaseRecorder({
    tables: {
      vehicles: rosters.vehicles,
      drivers: rosters.drivers,
      fuel_transactions: fills,
      declined_transactions: [],
      audit_logs: [],
    },
  });

/** The query that read the list — the rosters are read first, so it is the last one on that table. */
const listQuery = (rec: { forTable(t: string): RecordedQuery[] }, table: string): RecordedQuery =>
  rec.forTable(table).at(-1)!;
const filtersOf = (q: RecordedQuery) => q.filters().map((f) => [f.col, f.val] as const);
const opNames = (q: RecordedQuery) => q.ops.map((o) => o.method);

describe("the fills export describes the same rows the screen does", () => {
  it("scopes to the caller's org, because the service role bypasses RLS", async () => {
    const rec = seed();
    await exportFills(rec.client, { orgId: ORG, filters: {}, scope: SCOPE });
    expectOrgScoped(rec, ORG);
  });

  it("reads canonical fills only — the predicate that makes a row a fill and not a duplicate", async () => {
    const rec = seed();
    await exportFills(rec.client, { orgId: ORG, filters: {}, scope: SCOPE });
    expect(filtersOf(listQuery(rec, "fuel_transactions"))).toEqual(
      expect.arrayContaining([["org_id", ORG], ["is_canonical", true]]),
    );
  });

  it("applies the truck list and the window the page was showing", async () => {
    const rec = seed();
    await exportFills(rec.client, {
      orgId: ORG,
      filters: { vehicleIds: [V1, V2], from: "2026-08-01", to: "2026-08-31", tankType: "tractor" },
      scope: SCOPE,
    });
    const q = listQuery(rec, "fuel_transactions");
    expect(filtersOf(q)).toEqual(expect.arrayContaining([["vehicle_id", [V1, V2]], ["tank_type", "tractor"]]));
    // The window is the stored station-local business date (0287, D-FUI11), not the instant — the
    // same column the list filters, so the file and the screen mean one day by one name.
    expect(q.ops.filter((o) => o.method === "gte" || o.method === "lte").map((o) => o.args)).toEqual([
      ["business_date", "2026-08-01"],
      ["business_date", "2026-08-31"],
    ]);
  });

  /**
   * ⚠ The tiebreaker, which is invisible until it is not. A tied sort is not a total order, so a page
   * boundary inside one day's fills can repeat a row on one page and drop it from the next — the same
   * instability that took down the first full financial projection. Every export orders by `id` last.
   */
  it("orders every page by a unique key, so a page boundary cannot repeat or drop a row", async () => {
    const rec = seed();
    await exportFills(rec.client, { orgId: ORG, filters: {}, scope: SCOPE });
    expect(listQuery(rec, "fuel_transactions").ops.filter((o) => o.method === "order").map((o) => o.args[0])).toEqual([
      "business_date",
      "id",
    ]);
  });

  it("names the truck and the driver rather than exporting two UUIDs", async () => {
    const rec = seed();
    const out = await exportFills(rec.client, { orgId: ORG, filters: {}, scope: SCOPE });
    expect(out.csv).toContain("654");
    expect(out.csv).toContain("A Driver");
    expect(out.csv).not.toContain(V1);
  });

  it("says a fill names no truck rather than leaving the cell blank", async () => {
    // "Unattributed" is what the screen prints, and the difference between it and an empty cell is the
    // difference between a fact and a suspected export bug.
    const rec = seed([fill({ vehicle_id: null, driver_id: null })]);
    const out = await exportFills(rec.client, { orgId: ORG, filters: {}, scope: SCOPE });
    expect(out.csv).toContain("Unattributed");
  });

  it("carries the same verdict the Status badge shows, from the same function", async () => {
    const rec = seed([fill({ has_anomaly: true, max_severity: "critical" })]);
    const out = await exportFills(rec.client, { orgId: ORG, filters: {}, scope: SCOPE });
    expect(out.csv).toContain("Alert");
  });

  it("prints what the file covers on the file, because a CSV outlives its filter bar", async () => {
    const rec = seed();
    const out = await exportFills(rec.client, {
      orgId: ORG, filters: {}, scope: { ...SCOPE, trucks: 2 },
    });
    expect(out.csv.split("\r\n")[0]).toBe(
      "# Fuel log — fills · 2026-08-01 → 2026-08-31 · 2 trucks · 1 rows · generated 2026-09-04T12:00:00.000Z",
    );
  });

  it("says 'all trucks' when nothing was selected, rather than '0 trucks'", async () => {
    const rec = seed();
    const out = await exportFills(rec.client, { orgId: ORG, filters: {}, scope: SCOPE });
    expect(out.csv.split("\r\n")[0]).toContain("all trucks");
  });

  it("defuses a station name a spreadsheet would execute, and leaves a negative number alone", async () => {
    const rec = seed([fill({ location_text: "=HYPERLINK(\"http://x\")", total_cost: -12.5 })]);
    const out = await exportFills(rec.client, { orgId: ORG, filters: {}, scope: SCOPE });
    expect(out.csv).toContain("'=HYPERLINK");
    expect(out.csv).toContain("-12.5");
    expect(out.csv).not.toContain("'-12.5");
  });
});

describe("an export pages, and refuses rather than truncating", () => {
  const page = (n: number) => Array.from({ length: n }, (_, i) => fill({ id: `f${i}` }));

  it("keeps reading until a short page arrives — a thousand rows is where the server stops, not the data", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicles: rosters.vehicles,
        drivers: rosters.drivers,
        // Two full pages then a short one. `pages` drains on successive READS.
        fuel_transactions: { pages: [page(1000), page(1000), page(7)], count: 2007 },
        audit_logs: [],
      },
    });
    const out = await exportFills(rec.client, { orgId: ORG, filters: {}, scope: SCOPE });
    expect(out.rows).toBe(2007);
    expect(out.csv.split("\r\n")).toHaveLength(2007 + 2); // scope line + header + rows
  });

  it("refuses a selection past the ceiling and says how big it is, instead of producing a file that stops", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicles: rosters.vehicles,
        drivers: rosters.drivers,
        fuel_transactions: { pages: [page(1000)], count: MAX_EXPORT_ROWS + 1 },
        audit_logs: [],
      },
    });
    await expect(exportFills(rec.client, { orgId: ORG, filters: {}, scope: SCOPE })).rejects.toThrow(/50,001 rows/);
  });
});

describe("the declines export", () => {
  const decline = { id: "d1", declined_at: "2026-08-15T19:00:00Z", unit: "654", error_code: "51", error_description: "INVALID DRIVER ID", suspicion_level: "review", card_ref: "…1234", invoice: "I1", location_text: "Pilot 412", city: "Dallas", state: "TX", policy_name: "P1" };

  it("scopes to the org and windows on the reject feed's own clock", async () => {
    const rec = createSupabaseRecorder({ tables: { declined_transactions: [decline], audit_logs: [] } });
    await exportDeclines(rec.client, {
      orgId: ORG,
      filters: { from: "2026-08-01", to: "2026-08-31" },
      scope: { ...SCOPE, title: "Fuel log — declines" },
    });
    expectOrgScoped(rec, ORG);
    // ⚠ INSTANTS, not dates. EFS prints reject times in Central whatever the station's own zone is, so
    // the window is the Central day converted to UTC — a decline at 19:00 CT on 31 August is
    // 2026-09-01T00:00Z and belongs INSIDE an August export.
    const q = listQuery(rec, "declined_transactions");
    expect(q.ops.filter((o) => o.method === "gte" || o.method === "lt").map((o) => o.args)).toEqual([
      ["declined_at", "2026-08-01T05:00:00.000Z"],
      ["declined_at", "2026-09-01T05:00:00.000Z"],
    ]);
  });

  it("narrows to the units the page named", async () => {
    const rec = createSupabaseRecorder({ tables: { declined_transactions: [decline], audit_logs: [] } });
    await exportDeclines(rec.client, { orgId: ORG, filters: { units: ["654", "655"] }, scope: SCOPE });
    expect(filtersOf(listQuery(rec, "declined_transactions"))).toEqual(
      expect.arrayContaining([["unit", ["654", "655"]]]),
    );
  });

  it("orders by a unique key too", async () => {
    const rec = createSupabaseRecorder({ tables: { declined_transactions: [decline], audit_logs: [] } });
    await exportDeclines(rec.client, { orgId: ORG, filters: {}, scope: SCOPE });
    expect(opNames(listQuery(rec, "declined_transactions")).filter((m) => m === "order")).toHaveLength(2);
  });
});

describe("the page's URL parameters become the query's filters", () => {
  it("resolves unit numbers against the fleet, exactly as the browser does", () => {
    const f = fillFiltersFromQuery(
      { units: ["654", "655"], from: null, to: null, driverId: null, tankType: null, search: null },
      rosters,
    );
    expect(f.vehicleIds).toEqual([V1, V2]);
  });

  /**
   * ⚠ The three states, on the server side. A link naming only units this fleet has no row for must
   * narrow to nothing — an EMPTY list — and never widen to everything. The four such units are real:
   * 696, T005, T001 and T004, measured in production 2026-09-04.
   */
  it("narrows to nothing for units this fleet does not have", () => {
    const f = fillFiltersFromQuery(
      { units: ["696"], from: null, to: null, driverId: null, tankType: null, search: null },
      rosters,
    );
    expect(f.vehicleIds).toEqual([]);
  });

  it("asks for no truck filter at all when the URL names none", () => {
    const f = fillFiltersFromQuery(
      { units: [], from: null, to: null, driverId: null, tankType: null, search: null },
      rosters,
    );
    expect(f.vehicleIds).toBeUndefined();
  });

  it("resolves a typed search against the fleet and the roster, so the file and the screen match", () => {
    const f = fillFiltersFromQuery(
      { units: [], from: null, to: null, driverId: null, tankType: null, search: "65" },
      rosters,
    );
    expect(f).toMatchObject({ search: "65", searchVehicleIds: [V1, V2] });
    expect(f.searchDriverIds).toBeUndefined();
  });
});
