import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { ODOMETER_LOOKBACK_DAYS, readFleetDistance } from "./samsaraOdometerReads.js";

/**
 * The reader between the staged odometer readings and the distance rule (M2).
 *
 * The subtraction itself is proved in `packages/shared/src/tmsCost/vehicleDistance.test.ts`. What is
 * only testable here is the part a reader can get wrong invisibly:
 *
 *   • it reads only this org's readings — the service role bypasses RLS;
 *   • it fetches readings from BEFORE the period, because the period's ends are BOUNDING readings
 *     and reading only inside the window is a silent undercount (W3a's own trap);
 *   • it widens the SEARCH without widening the PERIOD — a lookback that leaked into the answer
 *     would report a month as though it were two;
 *   • a truck that staged nothing is absent rather than zero.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const FROM = "2026-07-06T00:00:00.000Z";
const TO = "2026-07-13T00:00:00.000Z";

interface ReadingFixture {
  vehicle_id: string;
  reading_at: string;
  meters: number;
  source: string;
}

const row = (vehicleId: string, readingAt: string, meters: number, source = "obd"): ReadingFixture => ({
  vehicle_id: vehicleId,
  reading_at: readingAt,
  meters,
  source,
});

/**
 * ⚠ A FUNCTION fixture, not an array, and that is load-bearing.
 *
 * `supabaseRecorder` RECORDS filters; it does not APPLY them. With a flat array the fake hands back
 * every row whatever the query asked for, so the lookback assertion below passes even when the
 * reader never asks for the lookback at all — which is precisely what the mutation check caught on
 * 2026-09-04: replacing `gte(reading_at, lookbackFrom)` with `gte(reading_at, fromIso)` left all ten
 * tests green. The whole correctness claim of this file is the lookback, so the fake has to honour
 * the window the reader asked for.
 */
const rec = (rows: ReadingFixture[]) =>
  createSupabaseRecorder({
    tables: {
      samsara_odometer_readings: (q) => {
        const f = q.filters();
        const bound = (col: string, method: "gte" | "lte") =>
          q.ops.find((o) => o.method === method && o.args[0] === col)?.args[1] as string | undefined;
        const lo = bound("reading_at", "gte");
        const hi = bound("reading_at", "lte");
        const org = f.find((x) => x.col === "org_id")?.val;
        return rows.filter(
          (r) =>
            (org === undefined || org === ORG) &&
            (lo === undefined || r.reading_at >= lo) &&
            (hi === undefined || r.reading_at <= hi),
        );
      },
    },
  });

/** One truck: an opening reading BEFORE the week, then one late on each of two days inside it. */
const ONE_WEEK = [
  row("v1", "2026-07-05T23:50:00Z", 663_000_000),
  row("v1", "2026-07-09T23:50:00Z", 663_500_000),
  row("v1", "2026-07-12T23:50:00Z", 663_804_672), // +804,672 m from the opening = 500.0 miles
];

describe("readFleetDistance", () => {
  it("scopes the read to one organization", async () => {
    const r = rec(ONE_WEEK);
    await readFleetDistance(r.client, ORG, FROM, TO);
    expectOrgScoped(r, ORG);
  });

  it("measures from the reading BEFORE the period, not the first one inside it", async () => {
    // The undercount this prevents: with one reading late each day, the readings strictly inside a
    // Monday-to-Monday week run Monday evening to Sunday evening — six days reported as seven.
    // Opening here is 05 July at 23:50, which is before the window starts.
    const r = rec(ONE_WEEK);
    const out = await readFleetDistance(r.client, ORG, FROM, TO);
    expect(out.perVehicle[0]).toMatchObject({
      vehicleId: "v1",
      fromAt: "2026-07-05T23:50:00Z",
      toAt: "2026-07-12T23:50:00Z",
      source: "obd",
    });
    expect(out.miles).toBe(500);
  });

  it("asks the database for the lookback window, and says where it began", async () => {
    const r = rec(ONE_WEEK);
    const out = await readFleetDistance(r.client, ORG, FROM, TO);
    const expected = new Date(Date.parse(FROM) - ODOMETER_LOOKBACK_DAYS * 86_400_000).toISOString();
    expect(out.lookbackFrom).toBe(expected);
    const filters = r.forTable("samsara_odometer_readings")[0]!.ops.map((o) => `${o.method}:${o.args[0]}`);
    expect(filters).toContain(`gte:reading_at`);
    expect(filters).toContain(`lte:reading_at`);
  });

  it("widens the SEARCH without widening the PERIOD", async () => {
    // A truck that also drove in June must not have June's miles counted into July's week. The
    // lookback exists to find the OPENING odometer, and nothing more.
    const r = rec([
      row("v1", "2026-06-20T23:50:00Z", 600_000_000), // deep in the lookback
      ...ONE_WEEK,
    ]);
    const out = await readFleetDistance(r.client, ORG, FROM, TO);
    expect(out.perVehicle[0]!.fromAt).toBe("2026-07-05T23:50:00Z");
    expect(out.miles).toBe(500);
  });

  it("ignores a reading after the period ends", async () => {
    const r = rec([...ONE_WEEK, row("v1", "2026-07-20T23:50:00Z", 999_000_000)]);
    const out = await readFleetDistance(r.client, ORG, FROM, TO);
    expect(out.miles).toBe(500);
  });

  it("counts a truck it cannot measure instead of scoring it zero", async () => {
    // One reading is not a period. A truck that reported once is not a truck that did not move.
    const r = rec([...ONE_WEEK, row("v2", "2026-07-09T23:50:00Z", 412_000_000)]);
    const out = await readFleetDistance(r.client, ORG, FROM, TO);
    expect(out.measuredVehicles).toBe(1);
    expect(out.unmeasuredVehicles).toBe(1);
    expect(out.perVehicle.find((v) => v.vehicleId === "v2")).toMatchObject({ miles: null });
    expect(out.miles).toBe(500);
  });

  it("keeps the counters apart — an ECU and a GPS counter have different origins", async () => {
    // A subtraction across them means nothing; the rule picks the best that can answer the period.
    const r = rec([
      row("v1", "2026-07-05T23:50:00Z", 663_000_000, "obd"),
      row("v1", "2026-07-12T23:50:00Z", 663_804_672, "obd"),
      row("v1", "2026-07-05T23:51:00Z", 120_000_000, "gps_distance"),
      row("v1", "2026-07-12T23:51:00Z", 130_000_000, "gps_distance"),
    ]);
    const out = await readFleetDistance(r.client, ORG, FROM, TO);
    expect(out.perVehicle[0]!.source).toBe("obd"); // Samsara's own ranking, best first
    expect(out.miles).toBe(500);
  });

  it("reports an empty table as empty, never as a fleet that stood still", async () => {
    // This is the state on the day the collector deploys, and a zero here would be a measured zero.
    const r = rec([]);
    const out = await readFleetDistance(r.client, ORG, FROM, TO);
    expect(out).toMatchObject({ miles: 0, measuredVehicles: 0, unmeasuredVehicles: 0, readings: 0 });
    expect(out.perVehicle).toEqual([]);
  });

  it("skips a row the collector could not have written rather than failing the whole fleet", async () => {
    const r = rec([...ONE_WEEK, row("v3", "2026-07-09T23:50:00Z", 1, "odometer")]);
    const out = await readFleetDistance(r.client, ORG, FROM, TO);
    expect(out.readings).toBe(3);
    expect(out.perVehicle.some((v) => v.vehicleId === "v3")).toBe(false);
  });

  it("refuses a period that ends before it starts, rather than returning a negative fleet", async () => {
    const r = rec(ONE_WEEK);
    await expect(readFleetDistance(r.client, ORG, TO, FROM)).rejects.toThrow(/ends before it starts/);
    await expect(readFleetDistance(r.client, ORG, "not-a-date", TO)).rejects.toThrow(/valid ISO/);
  });
});
