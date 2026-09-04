import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { getMileageCoverage } from "./mileageCoverage.js";

const ORG = "11111111-1111-1111-1111-111111111111";

/** Metres, as the table stores them: 1,000 miles is 1,609,344 m. */
const mi = (miles: number) => miles * 1609.344;

/**
 * Two short months and one complete one, shaped after the real 2026 rollout — February measured
 * fewer trucks than delivered, March measured every one.
 */
const SAMSARA = [
  { id: "1", vehicle_id: "v1", period_year: 2026, period_month: 2, total_meters: mi(600_000) },
  { id: "2", vehicle_id: "v2", period_year: 2026, period_month: 2, total_meters: mi(579_719) },
  { id: "3", vehicle_id: "v1", period_year: 2026, period_month: 3, total_meters: mi(700_000) },
  { id: "4", vehicle_id: "v2", period_year: 2026, period_month: 3, total_meters: mi(400_000) },
  { id: "5", vehicle_id: "v3", period_year: 2026, period_month: 3, total_meters: mi(270_444) },
];

const BILLS = [
  // February: THREE trucks delivered, Samsara measured two.
  { id: "b1", delivery_date: "2026-02-10", tractor_unit: "101", distance: 500_000, total_charges: 1_500_000, other_charge: 0, canceled: false },
  { id: "b2", delivery_date: "2026-02-20", tractor_unit: "102", distance: 400_000, total_charges: 1_200_000, other_charge: 0, canceled: false },
  { id: "b3", delivery_date: "2026-02-25", tractor_unit: "103", distance: 334_486, total_charges: 900_000, other_charge: 0, canceled: false },
  // March: three trucks delivered, three measured.
  { id: "b4", delivery_date: "2026-03-05", tractor_unit: "101", distance: 600_000, total_charges: 1_800_000, other_charge: 0, canceled: false },
  { id: "b5", delivery_date: "2026-03-15", tractor_unit: "102", distance: 400_000, total_charges: 1_100_000, other_charge: 50_000, canceled: false },
  { id: "b6", delivery_date: "2026-03-25", tractor_unit: "103", distance: 100_000, total_charges: 300_000, other_charge: 0, canceled: false },
  // A cancelled load: its miles were driven but never billed, so it must not enter the billed side.
  { id: "b7", delivery_date: "2026-03-28", tractor_unit: "104", distance: 999_999, total_charges: 1, other_charge: 0, canceled: true },
];

/**
 * Function fixtures rather than flat arrays, because the recorder records filters without applying
 * them: a flat array answers "April" with March's rows and every coverage assertion passes for the
 * wrong reason. Filtering HERE also makes the fixture prove the service asked correctly — a service
 * that forgot `.eq("period_month", …)` gets every month's rows and fails.
 */
const recorder = () =>
  createSupabaseRecorder({
    tables: {
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
        return BILLS.filter(
          (b) => (!gte || b.delivery_date >= gte) && (!lt || b.delivery_date < lt),
        );
      },
    },
  });

describe("getMileageCoverage", () => {
  it("refuses a period denominator when one of its months measured fewer trucks than delivered", async () => {
    const rec = recorder();
    const r = await getMileageCoverage(rec.client, ORG, "2026-02-01", "2026-03-31");
    expect(r.miles).toBeNull();
    expect(r.trucks).toBeNull();
    expect(r.reason).toContain("2026-02");
    expectOrgScoped(rec, ORG);
  });

  it("gives miles and the busiest month's truck count when every month is complete", async () => {
    const rec = recorder();
    const r = await getMileageCoverage(rec.client, ORG, "2026-03-01", "2026-03-31");
    expect(r.miles).toBe(1_370_444);
    expect(r.trucks).toBe(3);
    expect(r.reason).toBeNull();
  });

  it("reports each month separately, so a rollout gap cannot hide inside a total", async () => {
    const rec = recorder();
    const r = await getMileageCoverage(rec.client, ORG, "2026-02-01", "2026-03-31");
    const feb = r.months.find((m) => m.month === "2026-02")!;
    const mar = r.months.find((m) => m.month === "2026-03")!;
    expect(feb.measuredTrucks).toBe(2);
    expect(feb.deliveringTrucks).toBe(3);
    expect(feb.complete).toBe(false);
    expect(mar.complete).toBe(true);
  });

  it("buckets bills by delivery date, not by when the invoice was cut", async () => {
    const rec = recorder();
    const r = await getMileageCoverage(rec.client, ORG, "2026-03-01", "2026-03-31");
    // Only March's three loads, and the February ones are not dragged in by a later invoice date.
    expect(r.loads).toBe(3);
    expect(r.billedMiles).toBe(1_100_000);
  });

  it("leaves a cancelled load out of billed miles, loads and revenue", async () => {
    const rec = recorder();
    const r = await getMileageCoverage(rec.client, ORG, "2026-03-01", "2026-03-31");
    expect(r.billedMiles).not.toBe(2_099_999);
    expect(r.billedRevenue).toBe(3_250_000);
  });

  it("counts a month with no Samsara rows as short rather than as complete with zero", async () => {
    const rec = recorder();
    const r = await getMileageCoverage(rec.client, ORG, "2026-04-01", "2026-04-30");
    const apr = r.months.find((m) => m.month === "2026-04")!;
    expect(apr.measuredTrucks).toBe(0);
    expect(apr.complete).toBe(false);
    expect(r.miles).toBeNull();
  });

  it("covers every calendar month a period touches, including a partial last one", async () => {
    const rec = recorder();
    const r = await getMileageCoverage(rec.client, ORG, "2026-02-15", "2026-03-04");
    expect(r.months.map((m) => m.month)).toEqual(["2026-03", "2026-02"]);
  });
});
