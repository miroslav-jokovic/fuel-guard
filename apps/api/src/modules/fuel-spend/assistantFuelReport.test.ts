import { beforeEach, describe, expect, it, vi } from "vitest";
import { fuelCostsToQuery, fuelReportTotals, FUEL_REPORT_TRUCK_FIGURES_NOTE, type FuelReport, type FuelReportDay } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/** The tool's answer is `unknown` to its caller (it goes to the model as JSON); tests read named fields. */
type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * The assistant's `fuel_report` tool (F21 R1). What is pinned here is the promise in its header: the
 * figures are `readFuelReport`'s — the Fuel Costs page's — and the only things this tool decides are
 * which DAYS (on the carrier's clock) and which TRUCKS. So `readFuelReport` is replaced by a spy that
 * records what it was asked and answers a fixture; a test then checks the tool asked for the right
 * thing and copied the answer out unchanged.
 */
const readFuelReport = vi.fn();
vi.mock("./fuelReport.js", () => ({ readFuelReport: (...a: unknown[]) => readFuelReport(...a) }));

const { assistantFuelReport, resolveReportRange, monthsIn, normalizeUnit } = await import("./assistantFuelReport.js");

const ORG = "org-1";
const day = (d: string, o: Partial<FuelReportDay> = {}): FuelReportDay => ({
  day: d, network: "in", tank: "tractor", fills: 2, gallons: 210, spend: 850,
  retailFills: 0, retailGallons: 0, retailSpend: 0, retail: 0,
  contractFills: 0, contractGallons: 0, contractSpend: 0, contract: 0, ...o,
});

/** A report whose figures depend on the trucks asked for, so a per-truck row can be told from the total. */
function reportFor(from: string, to: string, vehicleIds: string[]): FuelReport {
  const k = vehicleIds.length || 10;
  const days = [day(from, { gallons: 100 * k, spend: 400 * k, fills: k }), day(from, { tank: "reefer", gallons: 5, spend: 20 })];
  const win = (mpg: number | null) => ({
    from, to, days, totals: fuelReportTotals(days),
    efficiency: {
      mpg: { mpg, reason: mpg == null ? "Too few trucks measured" : null, measuredShare: 0.9, partial: false, to, miles: 650 * k } as never,
      costPerMile: mpg == null ? null : 0.61,
    },
  });
  return { current: win(6 + k / 10), previous: win(null), trailingMpg: null, inNetworkBrands: [], sites: [] } as unknown as FuelReport;
}

const VEHICLES = [
  { id: "v748", unit_number: "748", status: "active" },
  { id: "v748old", unit_number: "748 - OLD", status: "retired" },
  { id: "v751", unit_number: "751", status: "active" },
  { id: "v900", unit_number: "900", status: "active" },
];
const recorder = () =>
  createSupabaseRecorder({
    tables: { vehicles: VEHICLES, organizations: [{ operating_hours: { tz: "America/Chicago" } }] },
  });
const NOV_10 = new Date("2026-11-10T15:00:00Z");

beforeEach(() => {
  readFuelReport.mockReset();
  readFuelReport.mockImplementation((_a, _o, from: string, to: string, f: { vehicleIds: string[] }) => Promise.resolve(reportFor(from, to, f.vehicleIds)));
});

describe("resolveReportRange — calendar periods on the carrier's clock", () => {
  const r = (input: Record<string, unknown>, today = "2026-11-10") => resolveReportRange(input, today);

  it("last month is the whole previous calendar month, across a year boundary too", () => {
    expect(r({ period: "last_month" })).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(r({ period: "last_month" }, "2026-01-15")).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(r({ period: "last_month" }, "2026-03-31")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("quarters are calendar quarters; last quarter in Q1 is the previous year's Q4", () => {
    expect(r({ period: "this_quarter" })).toMatchObject({ from: "2026-10-01", to: "2026-11-10", label: "Q4 2026 so far" });
    expect(r({ period: "last_quarter" })).toMatchObject({ from: "2026-07-01", to: "2026-09-30", label: "Q3 2026" });
    expect(r({ period: "last_quarter" }, "2026-02-03")).toMatchObject({ from: "2025-10-01", to: "2025-12-31", label: "Q4 2025" });
  });

  it("this month, year to date, last year, and last N days counted inclusively", () => {
    expect(r({ period: "this_month" })).toMatchObject({ from: "2026-11-01", to: "2026-11-10" });
    expect(r({ period: "year_to_date" })).toMatchObject({ from: "2026-01-01", to: "2026-11-10" });
    expect(r({ period: "last_year" })).toMatchObject({ from: "2025-01-01", to: "2025-12-31" });
    expect(r({ period: "last_n_days", days: 30 })).toMatchObject({ from: "2026-10-12", to: "2026-11-10" });
    expect(r({})).toMatchObject({ from: "2026-10-12", to: "2026-11-10" });
  });

  it("explicit dates win over a preset and are validated like the page's own query", () => {
    expect(r({ period: "last_month", from: "2026-09-01", to: "2026-09-30" })).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(r({ from: "2026-09-30", to: "2026-09-01" })).toEqual({ ok: false, error: "to is before from." });
    expect(r({ from: "09/01/2026", to: "2026-09-30" }).ok).toBe(false);
    expect(r({ from: "2025-01-01", to: "2026-06-30" }).ok).toBe(false);
  });
});

describe("monthsIn and normalizeUnit", () => {
  it("splits a range into calendar months clipped to the range", () => {
    expect(monthsIn("2026-09-15", "2026-11-10")).toEqual([
      { from: "2026-09-15", to: "2026-09-30" },
      { from: "2026-10-01", to: "2026-10-31" },
      { from: "2026-11-01", to: "2026-11-10" },
    ]);
  });
  it("matches a unit by case and surrounding words only", () => {
    expect(["748", " #748 ", "Unit 748", "truck 748"].map(normalizeUnit)).toEqual(["748", "748", "748", "748"]);
    expect(normalizeUnit("748 - OLD")).toBe("748 - old");
  });
});

describe("assistantFuelReport", () => {
  it("answers named units with one row per truck and the combined total, each the Fuel Costs report's own figures", async () => {
    const rec = recorder();
    const out = (await assistantFuelReport(rec.client, ORG, { units: ["748", "751"], period: "last_month" }, NOV_10)) as Out;

    const calls = readFuelReport.mock.calls.map((c) => ({ from: c[2], to: c[3], ids: c[4].vehicleIds, opts: c[5] }));
    expect(calls).toEqual([
      { from: "2026-10-01", to: "2026-10-31", ids: ["v748", "v751"], opts: { trailing: false, sites: false } },
      { from: "2026-10-01", to: "2026-10-31", ids: ["v748"], opts: { trailing: false, sites: false } },
      { from: "2026-10-01", to: "2026-10-31", ids: ["v751"], opts: { trailing: false, sites: false } },
    ]);
    // Copied, never recomputed: each row equals the page's answer for that truck.
    const page = reportFor("2026-10-01", "2026-10-31", ["v748"]).current;
    expect(out.by_truck[0]).toMatchObject({
      unit: "748", fills: page.totals.tractor.fills, gallons: page.totals.tractor.gallons, spend: page.totals.tractor.spend,
      price_per_gal: page.totals.tractor.pricePerGal, mpg: 6.1, fuel_cost_per_mile: 0.61, miles: 650,
      reefer_gallons: page.totals.reefer.gallons,
    });
    expect(out.total).toMatchObject({ mpg: 6.2, gallons: 200 });
    expect(out.previous_period).toMatchObject({ mpg: null, mpg_unavailable_because: "Too few trucks measured" });
    expect(out.scope).toEqual({ units: ["748", "751"], not_found: [], other_rows_for_these_units: [{ unit: "748 - OLD", status: "retired" }] });
    expectOrgScoped(rec, ORG);
  });

  // F21 R4b: the link a hand-built URL would get wrong three ways — unit numbers where the page takes
  // vehicle ids, "last quarter" where the page takes days, and an exclusive end where the page's `to`
  // is the last day INCLUDED.
  it("links to Fuel costs with the answer's own days and the named trucks by vehicle id, built by the page's contract", async () => {
    const out = (await assistantFuelReport(recorder().client, ORG, { units: ["748", "751"], period: "last_quarter" }, NOV_10)) as Out;
    expect(out.link).toEqual({ surfaceKey: "fuel.spend", query: { from: "2026-07-01", to: "2026-09-30", trucks: "v748,v751" } });
    expect(out.link.query).toEqual(fuelCostsToQuery({ from: "2026-07-01", to: "2026-09-30", vehicleIds: ["v748", "v751"] }));
    // The whole fleet carries no truck key: on this page an empty list means all, and `trucks=` would not.
    const fleet = (await assistantFuelReport(recorder().client, ORG, { period: "last_month" }, NOV_10)) as Out;
    expect(fleet.link).toEqual({ surfaceKey: "fuel.spend", query: { from: "2026-10-01", to: "2026-10-31" } });
  });

  it("gives no link when it gives no answer", async () => {
    const none = (await assistantFuelReport(recorder().client, ORG, { units: ["999"] }, NOV_10)) as Out;
    expect(none.link).toBeUndefined();
  });

  it("names units it cannot find, and never answers with the fleet when none are found", async () => {
    const some = (await assistantFuelReport(recorder().client, ORG, { units: ["748", "999"] }, NOV_10)) as Out;
    expect(some.scope.not_found).toEqual(["999"]);

    readFuelReport.mockClear();
    const none = await assistantFuelReport(recorder().client, ORG, { units: ["998", "999"] }, NOV_10);
    expect(none).toEqual({ error: "None of the named units are in this fleet.", not_found: ["998", "999"] });
    expect(readFuelReport).not.toHaveBeenCalled();
  });

  it("cuts 'last month' on the carrier's day: 10:00 pm Central on 10/31 is still October", async () => {
    const lateOct31Central = new Date("2026-11-01T03:00:00Z");
    await assistantFuelReport(recorder().client, ORG, { period: "last_month" }, lateOct31Central);
    expect(readFuelReport.mock.calls[0]!.slice(2, 4)).toEqual(["2026-09-01", "2026-09-30"]);
  });

  it("splits by calendar month over the same trucks", async () => {
    const out = (await assistantFuelReport(recorder().client, ORG, { units: ["751"], period: "last_quarter", by: "month" }, NOV_10)) as Out;
    expect(out.by_month.map((m: { from: string; to: string }) => [m.from, m.to])).toEqual([
      ["2026-07-01", "2026-07-31"], ["2026-08-01", "2026-08-31"], ["2026-09-01", "2026-09-30"],
    ]);
    expect(readFuelReport.mock.calls.every((c) => c[4].vehicleIds.join() === "v751")).toBe(true);
  });

  it("refuses a per-truck report with no units, and more than 25 units, instead of reading the whole fleet", async () => {
    expect(await assistantFuelReport(recorder().client, ORG, { by: "truck" }, NOV_10)).toMatchObject({ error: expect.stringContaining("unit numbers") });
    const many = Array.from({ length: 26 }, (_, i) => String(100 + i));
    expect(await assistantFuelReport(recorder().client, ORG, { units: many }, NOV_10)).toMatchObject({ error: expect.stringContaining("At most 25") });
    expect(readFuelReport).not.toHaveBeenCalled();
  });

  it("whole fleet when no units are named; a withheld MPG keeps the page's reason", async () => {
    readFuelReport.mockImplementationOnce((_a, _o, from: string, to: string) => {
      const r = reportFor(from, to, []);
      return Promise.resolve({ ...r, current: { ...r.current, efficiency: null } });
    });
    const out = (await assistantFuelReport(recorder().client, ORG, { period: "this_month" }, NOV_10)) as Out;
    expect(readFuelReport.mock.calls[0]![4].vehicleIds).toEqual([]);
    expect(out.scope).toBe("whole fleet");
    expect(out.total).toMatchObject({ mpg: null, mpg_unavailable_because: FUEL_REPORT_TRUCK_FIGURES_NOTE });
  });
});
