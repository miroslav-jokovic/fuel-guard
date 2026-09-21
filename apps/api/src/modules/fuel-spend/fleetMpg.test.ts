import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { getFleetMpg, getFleetMpgSeries } from "./fleetMpg.js";

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
  /** The rollup's own business date. Defaulted by `day()` so a test that does not care may omit it. */
  day?: string;
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
/**
 * `fuelThrough` is the roll-up's WATERMARK — how far `fuel_spend_days` has been derived, which
 * `getFleetMpg` clamps its window to (D-PREC2). It is deliberately a separate knob from `days`
 * rather than `max(day)` over them, because that is what it is in production: the watermark is
 * org-wide over the whole table, and a test seeding two truck-days in September is not saying the
 * sweep stopped in September.
 *
 * The default is past every window in this file, i.e. "the roll-up is up to date" — the condition
 * every test written before 2026-09-21 already assumed. Tests that care set it.
 */
const seed = (
  readings: Reading[],
  days: SpendDay[],
  { tz = "America/Chicago", fuelThrough = "2099-12-31" }: { tz?: string; fuelThrough?: string | null } = {},
) =>
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
      // A FUNCTION fixture here too, for the same reason as above: a weekly series asks this table
      // once and folds the rows per bucket, so a flat array would let every week answer with every
      // other week's fuel and the bucketing would test nothing.
      fuel_spend_days: (q) => {
        const at = (method: "gte" | "lte") =>
          q.ops.find((o) => o.method === method && o.args[0] === "day")?.args[1] as string | undefined;
        const lo = at("gte");
        const hi = at("lte");
        /**
         * ⚠ The WATERMARK read (`readFuelThrough`) is the one query here with no day bounds: it
         * orders by day descending and takes one row. The recorder RECORDS `.order()` and `.limit()`
         * and does not apply them — `.maybeSingle()` hands back `rows[0]` — so a fixture that
         * ignored the ordering would make the watermark whichever row happened to be declared
         * first, and every window in this file would clamp to it. Answered explicitly rather than
         * by sorting `days`, for the reason on `seed`.
         */
        if (lo === undefined && hi === undefined) {
          return fuelThrough == null ? [] : [{ day: fuelThrough }];
        }
        const scope = q.ops.find((o) => o.method === "in" && o.args[0] === "vehicle_id")?.args[1] as
          | string[]
          | undefined;
        return days
          .map((d) => ({ day: "2026-09-01", ...d }))
          .filter(
            (d) =>
              (lo === undefined || d.day >= lo) &&
              (hi === undefined || d.day <= hi) &&
              (scope === undefined || (d.vehicle_id != null && scope.includes(d.vehicle_id))),
          );
      },
    },
  });

/**
 * The GALLONS reads of `fuel_spend_days`, excluding the watermark read.
 *
 * Two different queries hit this table now and they answer different questions: one asks how far the
 * roll-up has derived (org-wide, no day bounds), the other asks for the period's fuel (day-bounded,
 * possibly truck-scoped). Selecting by SHAPE rather than by position, because `[0]` silently became
 * the wrong query the moment the watermark read was added in front of it — which is how three
 * assertions in this file started testing the wrong thing at once.
 */
const gallonReads = (rec: ReturnType<typeof seed>) =>
  rec.forTable("fuel_spend_days").filter((q) => q.ops.some((o) => o.method === "gte" && o.args[0] === "day"));

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
    const select = gallonReads(rec)[0]!.ops.find((o) => o.method === "select")!.args[0] as string;
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

/**
 * The truck scope (M4) — the Fuel log's own filter reaching this figure, so a tile and the rows
 * beneath it answer for the same trucks.
 */
describe("getFleetMpg — scoped to named trucks", () => {
  it("answers for only the trucks named, on both sides of the ratio", async () => {
    const rec = seed(READINGS, [
      { vehicle_id: "v1", gallons_tractor: 100 },
      { vehicle_id: "v2", gallons_tractor: 100 },
    ]);
    const r = await getFleetMpg(rec.client, ORG, "2026-09-01", "2026-09-03", ["v1"]);
    expect(r.trucksFuelled).toBe(1);
    expect(r.gallons).toBe(100);
    expect(r.miles).toBe(497.1); // v2 drove, and is not one of the trucks asked about
    expect(r.mpg).toBe(4.97);
  });

  it("leaves unattributed fuel out of a scoped figure, because it belongs to no named truck", async () => {
    // Charging a filtered figure with fuel from outside the filter would make the coverage line
    // beneath it read as a data problem when it is really a scoping one.
    const rec = seed(READINGS, [
      { vehicle_id: "v1", gallons_tractor: 100 },
      { vehicle_id: null, gallons_tractor: 400 },
    ]);
    const r = await getFleetMpg(rec.client, ORG, "2026-09-01", "2026-09-03", ["v1"]);
    expect(r.unattributedGallons).toBe(0);
    expect(r.gallons).toBe(100);
    expect(r.mpg).toBe(4.97);
  });

  it("treats an EMPTY scope as no trucks, never as the whole fleet", async () => {
    // "None of the units you named are in this fleet" has a correct answer, and it is not the fleet
    // average. Collapsing the two would show a filtered screen a figure for trucks it is not showing.
    const rec = seed(READINGS, [{ vehicle_id: "v1", gallons_tractor: 100 }]);
    const r = await getFleetMpg(rec.client, ORG, "2026-09-01", "2026-09-03", []);
    expect(r.gallons).toBe(0);
    // ⚠ The WATERMARK read still happens and should: how far the roll-up got is org-wide, not a
    // property of the trucks named, so scoping it to an empty list would make every filtered screen
    // believe the feed had never run. It is only the GALLONS read that is skipped.
    expect(gallonReads(rec)).toEqual([]);
    expect(r.mpg).toBeNull();
    expect(gallonReads(rec)).toEqual([]); // nothing to ask for
  });
});

/**
 * The weekly series (M4, D-MPG6) — a trend at week grain, from one read of each source.
 *
 * D-MPG6 retired the daily MPG trend on measured evidence: 1–3 September read 7.46, 6.90 and 6.38
 * over almost identical distances, because the fleet filled more tanks on the third. The series that
 * replaces it has to hold two properties that a naive implementation loses quietly.
 */
/** Two Monday-start weeks: 2026-08-31 → 09-06 and 09-07 → 09-13. File-scoped since the clamp tests
 *  at the bottom measure the same two weeks against a stalled roll-up. */
const WEEK_READINGS = [
  reading("v1", "2026-08-30T23:50:00Z", 663_000_000),
  reading("v1", "2026-09-06T23:50:00Z", 663_800_000), // +497.1 miles in week one
  reading("v1", "2026-09-13T23:50:00Z", 664_600_000), // +497.1 miles in week two
];
const WEEK_DAYS = [
  { day: "2026-09-02", vehicle_id: "v1", gallons_tractor: 100 },
  { day: "2026-09-09", vehicle_id: "v1", gallons_tractor: 50 },
];

describe("getFleetMpgSeries", () => {

  it("buckets on Monday-start weeks and folds each bucket's own fuel", async () => {
    const rec = seed(WEEK_READINGS, WEEK_DAYS);
    const r = await getFleetMpgSeries(rec.client, ORG, "2026-08-31", "2026-09-13", "week");
    expect(r.grain).toBe("week");
    expect(r.periods.map((p) => [p.from, p.to])).toEqual([
      ["2026-08-31", "2026-09-06"],
      ["2026-09-07", "2026-09-13"],
    ]);
    expect(r.periods[0]!.gallons).toBe(100);
    expect(r.periods[1]!.gallons).toBe(50);
    expect(r.periods[0]!.mpg).toBe(4.97); // 497.1 ÷ 100
    expect(r.periods[1]!.mpg).toBe(9.94); // 497.1 ÷ 50
  });

  it("computes the total over the WHOLE window, not as the mean of its buckets", async () => {
    // The two weeks read 4.97 and 9.94; their mean is 7.46 and it is not the fleet's figure for the
    // fortnight. 994.2 miles over 150 gallons is 6.63, and that is the number the headline shows.
    const rec = seed(WEEK_READINGS, WEEK_DAYS);
    const r = await getFleetMpgSeries(rec.client, ORG, "2026-08-31", "2026-09-13", "week");
    expect(r.total.miles).toBe(994.2);
    expect(r.total.gallons).toBe(150);
    expect(r.total.mpg).toBe(6.63);
    expect(r.total.mpg).not.toBe(Math.round(((4.97 + 9.94) / 2) * 100) / 100);
  });

  it("clamps the first and last bucket to the window asked about", async () => {
    // A trend ending 2026-09-09 that prints a bucket labelled "to 2026-09-13" reads as a bug in the
    // dates, and asks the odometer for days the caller did not ask about.
    const rec = seed(WEEK_READINGS, WEEK_DAYS);
    const r = await getFleetMpgSeries(rec.client, ORG, "2026-09-02", "2026-09-09", "week");
    expect(r.periods.map((p) => [p.from, p.to])).toEqual([
      ["2026-09-02", "2026-09-06"],
      ["2026-09-07", "2026-09-09"],
    ]);
  });

  it("reads each source once for the whole series", async () => {
    // A loop over `getFleetMpg` would re-fetch a thirty-day odometer lookback per bucket.
    const rec = seed(WEEK_READINGS, WEEK_DAYS);
    await getFleetMpgSeries(rec.client, ORG, "2026-08-31", "2026-09-13", "week");
    expect(rec.forTable("samsara_odometer_readings").length).toBe(1);
    expect(gallonReads(rec).length).toBe(1);
    // Plus exactly ONE watermark read for the whole series, not one per bucket: how far the roll-up
    // got is a property of the roll-up, so asking it six times would be six answers to one question.
    expect(rec.forTable("fuel_spend_days").length).toBe(2);
  });

  it("scopes every tenant query to one organization", async () => {
    const rec = seed(WEEK_READINGS, WEEK_DAYS);
    await getFleetMpgSeries(rec.client, ORG, "2026-08-31", "2026-09-13", "week");
    expectOrgScoped(rec, ORG, { exempt: ORG_LOOKUP });
  });
});

/**
 * The roll-up's reach bounds the window (D-PREC2).
 *
 * `fleetMpgWindow.test.ts` proves the RULE. What is only testable here is that the rule reaches the
 * two READS — because clamping the label alone would leave the bias exactly where it was, and the
 * answer would still be miles-over-a-month divided by gallons-over-three-weeks.
 */
describe("getFleetMpg — bounded by how far the fuel roll-up has derived", () => {
  it("asks BOTH sources for the clamped window, not just the gallons", async () => {
    const rec = seed(READINGS, [{ vehicle_id: "v1", gallons_tractor: 100 }], { fuelThrough: "2026-09-02" });
    const r = await getFleetMpg(rec.client, ORG, "2026-09-01", "2026-09-03");

    expect(r.to).toBe("2026-09-02");
    expect(r.requestedTo).toBe("2026-09-03");
    expect(r.partial).toBe(true);
    expect(r.fuelThrough).toBe("2026-09-02");

    // ⚠ The ODOMETER read is the half that matters and the half a label-only fix would miss. Chicago
    // is UTC−5 in September, so an inclusive 2 Sept ends at 05:00Z on the 3rd — the clamped day, not
    // the requested one. Mutate the service to clamp only the gallons and this is what fails.
    const odo = rec.forTable("samsara_odometer_readings")[0]!;
    const hi = odo.ops.find((o) => o.method === "lte" && o.args[0] === "reading_at")!.args[1];
    expect(hi).toBe("2026-09-03T05:00:00.000Z");

    const gal = gallonReads(rec)[0]!;
    expect(gal.ops.find((o) => o.method === "lte" && o.args[0] === "day")!.args[1]).toBe("2026-09-02");
  });

  it("still answers, and the figure is about the days it names", async () => {
    /**
     * ⚠ The readings have to sit inside the CLAMPED window, and the first draft of this test got
     * that wrong in a way worth keeping a note about: `READINGS` closes on 2026-09-03T23:50Z, which
     * is past the clamped end (2026-09-03T05:00Z, i.e. the start of the 3rd in Chicago), so v1 had
     * one bounding reading and no distance. The clamp really does narrow the odometer read — which
     * is the point of the test above — and a fixture that ignores it proves nothing.
     */
    const rec = seed(
      [
        reading("v1", "2026-08-31T23:50:00Z", 663_000_000),
        reading("v1", "2026-09-02T23:50:00Z", 663_800_000), // +497.1 miles, inside the clamp
      ],
      [{ vehicle_id: "v1", gallons_tractor: 100 }],
      { fuelThrough: "2026-09-02" },
    );
    const r = await getFleetMpg(rec.client, ORG, "2026-09-01", "2026-09-03");
    expect(r.mpg).toBe(4.97);
    expect(r.reason).toBeNull();
    expect(r.partial).toBe(true);
  });

  it("withholds with a sentence about the FEED when the roll-up has never run", async () => {
    const rec = seed(READINGS, [{ vehicle_id: "v1", gallons_tractor: 100 }], { fuelThrough: null });
    const r = await getFleetMpg(rec.client, ORG, "2026-09-01", "2026-09-03");
    expect(r.mpg).toBeNull();
    expect(r.reason).toMatch(/roll-up has not produced a single day/i);
    // The provenance still travels with a withheld figure (D-MPG1).
    expect(r.milesSource).toBe("measured");
  });

  it("does not turn a figure the ARITHMETIC withheld back on", async () => {
    // A healthy window whose fuel is only 40% measured: `computeFleetMpg` refuses on the coverage
    // floor, and a window that is perfectly fine must not overwrite that refusal with `null`.
    const rec = seed(READINGS, [
      { vehicle_id: "v1", gallons_tractor: 100 },
      { vehicle_id: "v9", gallons_tractor: 150 },
    ]);
    const r = await getFleetMpg(rec.client, ORG, "2026-09-01", "2026-09-03");
    expect(r.mpg).toBeNull();
    expect(r.reason).toMatch(/measured distance behind it/i);
  });
});

describe("getFleetMpgSeries — bounded by the same reach", () => {
  it("cuts the BUCKETS over the clamped window, so no week is miles with no gallons", async () => {
    // The 2026-09-14 week is exactly the shape that read 22.82 MPG on 7,318 gallons during the
    // outage: real miles, almost no fuel. A series that stops at the watermark cannot draw it.
    const rec = seed(WEEK_READINGS, WEEK_DAYS, { fuelThrough: "2026-09-08" });
    const s = await getFleetMpgSeries(rec.client, ORG, "2026-08-31", "2026-09-13", "week");

    expect(s.total.to).toBe("2026-09-08");
    expect(s.total.partial).toBe(true);
    expect(s.periods.map((p) => [p.from, p.to])).toEqual([
      ["2026-08-31", "2026-09-06"],
      ["2026-09-07", "2026-09-08"],
    ]);
    // ⚠ A bucket that survives the clamp is NOT itself partial — its end is at or before the
    // watermark by construction — so the flag stays a fact about the row rather than about the row
    // above it. A surface that dimmed every bucket of a partial series would be wrong twice.
    expect(s.periods.every((p) => !p.partial)).toBe(true);
  });
});
