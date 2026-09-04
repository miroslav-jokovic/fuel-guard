import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { getFleetTrend } from "./fleetTrend.js";

const ORG = "11111111-1111-1111-1111-111111111111";

/** Metres, as `samsara_ifta_jurisdiction_miles` stores them. */
const mi = (miles: number) => miles * 1609.344;

/**
 * Three months, shaped after the real 2026 rollout: February measured fewer trucks than delivered
 * loads, March and April measured every one. The service's whole job is bucketing, so what these
 * fixtures have to discriminate is which rows landed in which month — which is why every one of
 * them below is filtered by the query the service actually issued, not handed back as a flat array.
 */
const GL_TOTALS = [
  { period_start: "2026-02-01", period_end: "2026-03-01", swept_at: "2026-03-03 04:00:00+00", glid: "30000001", post_module: "BILL", net_amount: -2_000_000, line_count: 1, abs_amount: 2_000_000 },
  { period_start: "2026-02-01", period_end: "2026-03-01", swept_at: "2026-03-03 04:00:00+00", glid: "40000001", post_module: "SET", net_amount: 1_800_000, line_count: 1, abs_amount: 1_800_000 },
  { period_start: "2026-03-01", period_end: "2026-04-01", swept_at: "2026-04-03 04:00:00+00", glid: "30000001", post_module: "BILL", net_amount: -4_000_000, line_count: 1, abs_amount: 4_000_000 },
  { period_start: "2026-03-01", period_end: "2026-04-01", swept_at: "2026-04-03 04:00:00+00", glid: "40000001", post_module: "SET", net_amount: 3_500_000, line_count: 1, abs_amount: 3_500_000 },
  // April: two revenue rows in the same month, so a bucket that keeps only the last row is visible.
  { period_start: "2026-04-01", period_end: "2026-05-01", swept_at: "2026-05-03 04:00:00+00", glid: "30000001", post_module: "BILL", net_amount: -3_000_000, line_count: 1, abs_amount: 3_000_000 },
  { period_start: "2026-04-01", period_end: "2026-05-01", swept_at: "2026-05-03 04:00:00+00", glid: "30000001", post_module: "AP", net_amount: -1_000_000, line_count: 1, abs_amount: 1_000_000 },
  { period_start: "2026-04-01", period_end: "2026-05-01", swept_at: "2026-05-03 04:00:00+00", glid: "40000001", post_module: "SET", net_amount: 3_600_000, line_count: 1, abs_amount: 3_600_000 },
  // August as production held it on 2026-09-03: swept on the 28th, four days before the month
  // ended, holding one expense line and no revenue. Plotted, it is a cliff to the axis (G11).
  { period_start: "2026-08-01", period_end: "2026-09-01", swept_at: "2026-08-28 21:02:56.551+00", glid: "40000001", post_module: "SET", net_amount: 8430, line_count: 11, abs_amount: 8430 },
  // May is outside every window asked for below — it is here so a service that forgot its upper
  // bound plots a fourth point and fails rather than passing with an extra month nobody sees.
  { period_start: "2026-05-01", period_end: "2026-06-01", swept_at: "2026-06-03 04:00:00+00", glid: "30000001", post_module: "BILL", net_amount: -9_999_999, line_count: 1, abs_amount: 9_999_999 },
];

const ACCOUNTS = [
  { glid: "30000001", descr: "Gross Trucking Income", type_id: "Revenue" },
  { glid: "40000001", descr: "Subcontracted Labor: Driver", type_id: "Operating Expenses" },
];

const SAMSARA = [
  { id: "1", vehicle_id: "v1", period_year: 2026, period_month: 2, total_meters: mi(600_000) },
  { id: "2", vehicle_id: "v2", period_year: 2026, period_month: 2, total_meters: mi(579_719) },
  { id: "3", vehicle_id: "v1", period_year: 2026, period_month: 3, total_meters: mi(700_000) },
  { id: "4", vehicle_id: "v2", period_year: 2026, period_month: 3, total_meters: mi(400_000) },
  { id: "5", vehicle_id: "v3", period_year: 2026, period_month: 3, total_meters: mi(270_444) },
  { id: "6", vehicle_id: "v1", period_year: 2026, period_month: 4, total_meters: mi(800_000) },
  { id: "7", vehicle_id: "v2", period_year: 2026, period_month: 4, total_meters: mi(692_407) },
];

const BILLS = [
  // February: three trucks delivered, Samsara measured two — the month that loses its rates.
  { id: "b1", delivery_date: "2026-02-10", tractor_unit: "101", distance: 500_000, total_charges: 1_500_000, other_charge: 0, canceled: false },
  { id: "b2", delivery_date: "2026-02-20", tractor_unit: "102", distance: 400_000, total_charges: 1_200_000, other_charge: 0, canceled: false },
  { id: "b3", delivery_date: "2026-02-25", tractor_unit: "103", distance: 334_486, total_charges: 900_000, other_charge: 0, canceled: false },
  { id: "b4", delivery_date: "2026-03-05", tractor_unit: "101", distance: 600_000, total_charges: 1_800_000, other_charge: 0, canceled: false },
  { id: "b5", delivery_date: "2026-03-15", tractor_unit: "102", distance: 400_000, total_charges: 1_100_000, other_charge: 0, canceled: false },
  { id: "b6", delivery_date: "2026-03-25", tractor_unit: "103", distance: 391_350, total_charges: 300_000, other_charge: 0, canceled: false },
  { id: "b7", delivery_date: "2026-04-12", tractor_unit: "101", distance: 700_000, total_charges: 2_000_000, other_charge: 0, canceled: false },
  { id: "b8", delivery_date: "2026-04-22", tractor_unit: "102", distance: 648_180, total_charges: 1_500_000, other_charge: 0, canceled: false },
];

/**
 * Function fixtures, because `supabaseRecorder` records filters without applying them: a flat array
 * answers "March" with every month's rows, and a bucketing service tested against one passes while
 * putting the whole ledger in every point. Filtering here also makes the fixture prove the service
 * asked correctly — one that drops its window gets May and fails.
 */
const recorder = () =>
  createSupabaseRecorder({
    tables: {
      mcleod_gl_totals: (q) => {
        const ops = q.ops;
        const gte = ops.find((o) => o.method === "gte" && o.args[0] === "period_start")?.args[1] as string | undefined;
        const lt = ops.find((o) => o.method === "lt" && o.args[0] === "period_start")?.args[1] as string | undefined;
        return GL_TOTALS.filter((r) => (!gte || r.period_start >= gte) && (!lt || r.period_start < lt));
      },
      mcleod_gl_accounts: () => ACCOUNTS,
      samsara_ifta_jurisdiction_miles: (q) => {
        const f = q.filters();
        const year = f.find((x) => x.col === "period_year")?.val;
        const month = f.find((x) => x.col === "period_month")?.val;
        return SAMSARA.filter((r) => r.period_year === year && r.period_month === month);
      },
      mcleod_billing: (q) => {
        const ops = q.ops;
        const gte = ops.find((o) => o.method === "gte" && o.args[0] === "delivery_date")?.args[1] as string | undefined;
        const lt = ops.find((o) => o.method === "lt" && o.args[0] === "delivery_date")?.args[1] as string | undefined;
        return BILLS.filter((b) => (!gte || b.delivery_date >= gte) && (!lt || b.delivery_date < lt));
      },
    },
  });

describe("getFleetTrend", () => {
  it("returns one point per whole month back from the requested date, oldest first", async () => {
    const rec = recorder();
    const t = await getFleetTrend(rec.client, ORG, "2026-04-20", 3);
    expect(t.monthsRequested).toEqual(["2026-02", "2026-03", "2026-04"]);
    expect(t.points.map((p) => p.month)).toEqual(["2026-02", "2026-03", "2026-04"]);
    expectOrgScoped(rec, ORG);
  });

  /**
   * The point a reader checks first. March's money is March's alone — a bucketing slip that hands a
   * point its neighbour's rows leaves every figure on the chart plausible and every one of them
   * wrong.
   */
  it("puts each month's ledger rows in that month and no other", async () => {
    const t = await getFleetTrend(recorder().client, ORG, "2026-04-20", 3);
    const march = t.points.find((p) => p.month === "2026-03")!;
    expect(march.revenue).toBe(4_000_000);
    expect(march.expenses).toBe(3_500_000);
    expect(march.miles).toBe(1_370_444);
    expect(march.costPerMile).toBe(2.55);
  });

  it("sums every posting module inside a month rather than taking one of them", async () => {
    const t = await getFleetTrend(recorder().client, ORG, "2026-04-20", 3);
    // April's revenue arrived as a BILL row and an AP row; the month earned both.
    expect(t.points.find((p) => p.month === "2026-04")!.revenue).toBe(4_000_000);
  });

  it("keeps a short-coverage month's money and refuses its rates", async () => {
    const t = await getFleetTrend(recorder().client, ORG, "2026-04-20", 3);
    const feb = t.points.find((p) => p.month === "2026-02")!;
    expect(feb.revenue).toBe(2_000_000);
    expect(feb.costPerMile).toBeNull();
    expect(feb.reason).toContain("2026-02");
    expect(t.rated).toBe(2);
  });

  it("names a month the ledger has not reached instead of plotting it at zero", async () => {
    const t = await getFleetTrend(recorder().client, ORG, "2026-04-20", 4);
    expect(t.monthsRequested).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(t.missing).toEqual(["2026-01"]);
    expect(t.points.map((p) => p.month)).not.toContain("2026-01");
  });

  /**
   * Two halves of one claim. The series must END at the requested month — May's row exists in the
   * fixture and must not appear — and the ledger READ must stop there too: an unbounded read is
   * eleven months of rows fetched to be discarded, which no assertion about the output can see.
   */
  it("ends the series at the month the requested date falls in, and reads no further", async () => {
    const rec = recorder();
    const t = await getFleetTrend(rec.client, ORG, "2026-04-20", 3);
    expect(t.points.map((p) => p.month)).not.toContain("2026-05");
    expect(t.points.every((p) => p.revenue !== 9_999_999)).toBe(true);

    const ledgerRead = rec.forTable("mcleod_gl_totals")[0]!;
    const bound = (method: string) =>
      ledgerRead.ops.find((o) => o.method === method && o.args[0] === "period_start")?.args[1];
    expect(bound("gte")).toBe("2026-02-01");
    expect(bound("lt")).toBe("2026-05-01");

    // Coverage is read a month at a time, so the same claim is checkable there: three months asked
    // for, three Samsara reads, and no fourth for a month that is not on the chart.
    const samsaraMonths = rec
      .forTable("samsara_ifta_jurisdiction_miles")
      .map((q) => q.filters().find((f) => f.col === "period_month")?.val);
    expect(samsaraMonths).toEqual([2, 3, 4]);
  });

  it("counts a whole month back over a year boundary", async () => {
    const t = await getFleetTrend(recorder().client, ORG, "2026-02-14", 3);
    expect(t.monthsRequested).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  /**
   * The last point of a twelve-month chart is the month the reader is looking at, and on the 3rd of
   * a month that is a month the sweep has not finished. Drawn, it is a collapse to the axis that
   * never happened.
   */
  it("drops a month swept before it ended rather than drawing it at zero", async () => {
    const t = await getFleetTrend(recorder().client, ORG, "2026-08-15", 3);
    expect(t.monthsRequested).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(t.points.map((p) => p.month)).not.toContain("2026-08");
    expect(t.monthsPartial.map((m) => m.month)).toEqual(["2026-08"]);
    // It joins the months with no ledger at all: not plotted, and named beneath the chart.
    expect(t.missing).toContain("2026-08");
  });
});
