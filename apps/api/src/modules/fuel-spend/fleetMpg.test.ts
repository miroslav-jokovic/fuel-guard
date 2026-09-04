import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { getFleetMpg } from "./fleetMpg.js";

/**
 * The pairing between measured miles and the fuel that moved them (M3).
 *
 * The arithmetic is proved in `fleetEfficiency.test.ts` and the distance in
 * `samsaraOdometerReads.test.ts`. What is only testable here is the pairing, which is where the
 * remaining judgement lives:
 *
 *   • miles and gallons are summed over the SAME trucks, so neither side can carry a truck the
 *     other does not;
 *   • a truck that fuelled and could not be measured is COUNTED and its gallons stay in the
 *     period's total, so the coverage figure is honest;
 *   • reefer and DEF are excluded because `gallons_tractor` is what is read, not because reefer
 *     fills happen to carry no MPG today (D-MPG5);
 *   • the days are resolved on the FLEET's clock, so the two sources are cut at the same instant.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
/** `organizations` is read by primary key for the day boundary — no org_id to scope by. */
const ORG_LOOKUP = ["organizations"];

interface Reading {
  vehicle_id: string;
  reading_at: string;
  meters: number;
  source: string;
}
interface SpendDay {
  vehicle_id: string | null;
  gallons_tractor: number;
}

const reading = (vehicleId: string, at: string, meters: number, source = "obd"): Reading => ({
  vehicle_id: vehicleId,
  reading_at: at,
  meters,
  source,
});

/**
 * ⚠ Function fixtures, because `supabaseRecorder` records filters and does NOT apply them — a flat
 * array answers a July question with June's rows, and the odometer read's whole correctness is which
 * window it asked for (see samsaraOdometerReads.test.ts's header for the mutant that proved it).
 */
const seed = (readings: Reading[], days: SpendDay[], tz = "America/Chicago") =>
  createSupabaseRecorder({
    tables: {
      organizations: [{ id: ORG, operating_hours: { tz } }],
      samsara_odometer_readings: (q) => {
        const at = (method: "gte" | "lte") =>
          q.ops.find((o) => o.method === method && o.args[0] === "reading_at")?.args[1] as string | undefined;
        const lo = at("gte");
        const hi = at("lte");
        return readings.filter(
          (r) => (lo === undefined || r.reading_at >= lo) && (hi === undefined || r.reading_at <= hi),
        );
      },
      fuel_spend_days: days,
    },
  });

/** 800,000 m ≈ 497.1 miles; 100 gallons → ~4.97 MPG. Two trucks make the pairing visible. */
const READINGS = [
  reading("v1", "2026-08-31T23:50:00Z", 663_000_000),
  reading("v1", "2026-09-03T23:50:00Z", 663_800_000),
  reading("v2", "2026-08-31T23:45:00Z", 412_000_000),
  reading("v2", "2026-09-03T23:45:00Z", 412_800_000),
];

describe("getFleetMpg", () => {
  it("scopes every tenant query to one organization", async () => {
    const rec = seed(READINGS, [{ vehicle_id: "v1", gallons_tractor: 100 }]);
    await getFleetMpg(rec.client, ORG, "2026-09-01", "2026-09-03");
    expectOrgScoped(rec, ORG, { exempt: ORG_LOOKUP });
  });

  it("pairs the miles and the gallons of the SAME trucks", async () => {
    const rec = seed(READINGS, [
      { vehicle_id: "v1", gallons_tractor: 100 },
      { vehicle_id: "v2", gallons_tractor: 100 },
    ]);
    const r = await getFleetMpg(rec.client, ORG, "2026-09-01", "2026-09-03");
    expect(r.trucksMeasured).toBe(2);
    expect(r.miles).toBe(994.2); // 497.1 × 2
    expect(r.gallonsWithMiles).toBe(200);
    expect(r.mpg).toBe(4.97);
    expect(r.milesSource).toBe("measured");
  });

  it("does not count a truck that drove but bought no fuel", async () => {
    // Its miles would enter the numerator with nothing behind them in the denominator, and MPG
    // would read high — plausibly, which is the dangerous kind.
    const rec = seed(READINGS, [{ vehicle_id: "v1", gallons_tractor: 100 }]);
    const r = await getFleetMpg(rec.client, ORG, "2026-09-01", "2026-09-03");
    expect(r.trucksMeasured).toBe(1);
    expect(r.miles).toBe(497.1);
    expect(r.mpg).toBe(4.97);
  });

  it("counts a truck that fuelled and could not be measured, and keeps its gallons in the total", async () => {
    // v3 bought 60 gallons and staged no readings. Its fuel is real, so it stays in `gallons` and
    // drags `measuredShare` down — which is exactly what a reader needs to see.
    const rec = seed(READINGS, [
      { vehicle_id: "v1", gallons_tractor: 100 },
      { vehicle_id: "v2", gallons_tractor: 100 },
      { vehicle_id: "v3", gallons_tractor: 60 },
    ]);
    const r = await getFleetMpg(rec.client, ORG, "2026-09-01", "2026-09-03");
    expect(r.trucksUnmeasured).toBe(1);
    expect(r.trucksFuelled).toBe(3);
    expect(r.gallons).toBe(260);
    expect(r.gallonsWithMiles).toBe(200);
    expect(r.measuredShare).toBe(0.769);
    expect(r.mpg).toBe(4.97); // still 994.2 ÷ 200 — the unmeasured truck cannot change the ratio
  });

  it("withholds the figure when too little of the fuel has a measured mile behind it", async () => {
    const rec = seed(READINGS, [
      { vehicle_id: "v1", gallons_tractor: 100 },
      { vehicle_id: "v9", gallons_tractor: 900 },
    ]);
    const r = await getFleetMpg(rec.client, ORG, "2026-09-01", "2026-09-03");
    expect(r.mpg).toBeNull();
    expect(r.reason).toMatch(/10% of this period's fuel/);
  });

  it("keeps unattributed fuel in the total and never in the measured half", async () => {
    // D-FS2: a fill we could not attribute is never dropped and never guessed. It can never have a
    // mile behind it, so it can only ever reduce coverage.
    const rec = seed(READINGS, [
      { vehicle_id: "v1", gallons_tractor: 100 },
      { vehicle_id: "v2", gallons_tractor: 100 },
      { vehicle_id: null, gallons_tractor: 40 },
    ]);
    const r = await getFleetMpg(rec.client, ORG, "2026-09-01", "2026-09-03");
    expect(r.unattributedGallons).toBe(40);
    expect(r.gallons).toBe(240);
    expect(r.gallonsWithMiles).toBe(200);
    expect(r.trucksFuelled).toBe(2); // the null-vehicle row is fuel, not a truck
  });

  it("reads TRACTOR gallons, so reefer and DEF cannot enter the denominator", async () => {
    // Explicit, not incidental: the reefer column is never selected, so a scoring change that
    // started giving reefer fills an MPG could not leak them in (D-MPG5).
    const rec = seed(READINGS, [{ vehicle_id: "v1", gallons_tractor: 100 }]);
    await getFleetMpg(rec.client, ORG, "2026-09-01", "2026-09-03");
    const select = rec
      .forTable("fuel_spend_days")[0]!
      .ops.find((o) => o.method === "select")!.args[0] as string;
    expect(select).toContain("gallons_tractor");
    expect(select).not.toContain("gallons_reefer");
    expect(select).not.toContain("gallons_def");
  });

  it("cuts both sources on the fleet's clock, and makes `to` mean the whole of that day", async () => {
    // Chicago in September is UTC−5, so 1 Sept locally begins at 05:00Z and 3 Sept ends at 05:00Z on
    // the 4th. Resolving on the server's clock would put a night's driving in the wrong month.
    const rec = seed(READINGS, [{ vehicle_id: "v1", gallons_tractor: 100 }]);
    const r = await getFleetMpg(rec.client, ORG, "2026-09-01", "2026-09-03");
    expect(r.timezone).toBe("America/Chicago");
    const q = rec.forTable("samsara_odometer_readings")[0]!;
    const upper = q.ops.find((o) => o.method === "lte" && o.args[0] === "reading_at")!.args[1];
    expect(upper).toBe("2026-09-04T05:00:00.000Z");
  });

  it("says the collector has not run rather than reporting a fleet that stood still", async () => {
    const rec = seed([], [{ vehicle_id: "v1", gallons_tractor: 100 }]);
    const r = await getFleetMpg(rec.client, ORG, "2026-09-01", "2026-09-03");
    expect(r.readings).toBe(0);
    expect(r.mpg).toBeNull();
    expect(r.reason).toMatch(/no fuel in this period has a measured distance/i);
  });
});
