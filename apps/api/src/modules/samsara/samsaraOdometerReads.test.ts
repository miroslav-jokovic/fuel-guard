import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { odometerFunctionModel, pgInstant } from "../../testing/odometerFunctionModel.js";
import {
  ODOMETER_LOOKBACK_DAYS,
  readFleetDistance,
  readFleetDistancePeriods,
} from "./samsaraOdometerReads.js";

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
const pagedTable = (rows: ReadingFixture[]) => (q: RecordedQuery) => {
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
};

type Read = "function" | "paged";
/**
 * The fake database. `function` (production since 0507) answers `odometer_readings_for_periods`;
 * `paged` answers PGRST202 for it, as staging does in the minutes before 0507 is applied, so the
 * reader falls back to the paged table read.
 */
const rec = (rows: ReadingFixture[], read: Read = "function") =>
  createSupabaseRecorder({
    tables: { samsara_odometer_readings: pagedTable(rows) },
    rpc: (fn, args) =>
      fn !== "odometer_readings_for_periods"
        ? null
        : read === "paged"
          ? { error: { code: "PGRST202", message: "Could not find the function public.odometer_readings_for_periods" } }
          : odometerFunctionModel(rows, ORG)(args),
  });

/** One truck: an opening reading BEFORE the week, then one late on each of two days inside it. */
const ONE_WEEK = [
  row("v1", "2026-07-05T23:50:00Z", 663_000_000),
  row("v1", "2026-07-09T23:50:00Z", 663_500_000),
  row("v1", "2026-07-12T23:50:00Z", 663_804_672), // +804,672 m from the opening = 500.0 miles
];

describe.each<Read>(["function", "paged"])("readFleetDistance (%s read)", (read) => {
  it("scopes the read to one organization", async () => {
    const r = rec(ONE_WEEK, read);
    await readFleetDistance(r.client, ORG, FROM, TO);
    expectOrgScoped(r, ORG);
  });

  it("measures from the reading BEFORE the period, not the first one inside it", async () => {
    // The undercount this prevents: with one reading late each day, the readings strictly inside a
    // Monday-to-Monday week run Monday evening to Sunday evening — six days reported as seven.
    // Opening here is 05 July at 23:50, which is before the window starts.
    const r = rec(ONE_WEEK, read);
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
    const r = rec(ONE_WEEK, read);
    const out = await readFleetDistance(r.client, ORG, FROM, TO);
    const expected = new Date(Date.parse(FROM) - ODOMETER_LOOKBACK_DAYS * 86_400_000).toISOString();
    expect(out.lookbackFrom).toBe(expected);
    if (read === "function") {
      // One call, carrying the period's own floor — the lookback — for the database to search from.
      expect(r.rpcs()).toEqual([{ fn: "odometer_readings_for_periods", args: { p_org: ORG, p_periods: [{ from: FROM, to: TO, floor: expected }] } }]);
      expect(r.forTable("samsara_odometer_readings")).toHaveLength(0);
    } else {
      const filters = r.forTable("samsara_odometer_readings")[0]!.ops.map((o) => `${o.method}:${o.args[0]}`);
      expect(filters).toContain(`gte:reading_at`);
      expect(filters).toContain(`lte:reading_at`);
    }
  });

  it("widens the SEARCH without widening the PERIOD", async () => {
    // A truck that also drove in June must not have June's miles counted into July's week. The
    // lookback exists to find the OPENING odometer, and nothing more.
    const r = rec([
      row("v1", "2026-06-20T23:50:00Z", 600_000_000), // deep in the lookback
      ...ONE_WEEK,
    ], read);
    const out = await readFleetDistance(r.client, ORG, FROM, TO);
    expect(out.perVehicle[0]!.fromAt).toBe("2026-07-05T23:50:00Z");
    expect(out.miles).toBe(500);
  });

  it("ignores a reading after the period ends", async () => {
    const r = rec([...ONE_WEEK, row("v1", "2026-07-20T23:50:00Z", 999_000_000)], read);
    const out = await readFleetDistance(r.client, ORG, FROM, TO);
    expect(out.miles).toBe(500);
  });

  it("counts a truck it cannot measure instead of scoring it zero", async () => {
    // One reading is not a period. A truck that reported once is not a truck that did not move.
    const r = rec([...ONE_WEEK, row("v2", "2026-07-09T23:50:00Z", 412_000_000)], read);
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
    ], read);
    const out = await readFleetDistance(r.client, ORG, FROM, TO);
    expect(out.perVehicle[0]!.source).toBe("obd"); // Samsara's own ranking, best first
    expect(out.miles).toBe(500);
  });

  it("reports an empty table as empty, never as a fleet that stood still", async () => {
    // This is the state on the day the collector deploys, and a zero here would be a measured zero.
    const r = rec([], read);
    const out = await readFleetDistance(r.client, ORG, FROM, TO);
    expect(out).toMatchObject({ miles: 0, measuredVehicles: 0, unmeasuredVehicles: 0, readings: 0 });
    expect(out.perVehicle).toEqual([]);
  });

  it("skips a row the collector could not have written rather than failing the whole fleet", async () => {
    const r = rec([...ONE_WEEK, row("v3", "2026-07-09T23:50:00Z", 1, "odometer")], read);
    const out = await readFleetDistance(r.client, ORG, FROM, TO);
    expect(out.readings).toBe(3);
    expect(out.perVehicle.some((v) => v.vehicleId === "v3")).toBe(false);
  });

  it("refuses a period that ends before it starts, rather than returning a negative fleet", async () => {
    const r = rec(ONE_WEEK, read);
    await expect(readFleetDistance(r.client, ORG, TO, FROM)).rejects.toThrow(/ends before it starts/);
    await expect(readFleetDistance(r.client, ORG, "not-a-date", TO)).rejects.toThrow(/valid ISO/);
  });
});

/**
 * The BATCHED form (M4) — the same measurement for several periods from one read of the table.
 *
 * The weekly trend D-MPG6 put in place of the daily one asks this question five or six times for one
 * window, and a loop over `readFleetDistance` would fetch a thirty-day lookback each time. The two
 * things that can go wrong when the fetch is shared are both tested here, because neither shows up
 * as an error:
 *
 *   • a period could see readings from OUTSIDE its own lookback — the shared fetch reaches back
 *     thirty days before the EARLIEST period, so a later week handed the whole set could measure a
 *     truck its own read would have called unmeasured, and the series' weeks would each have been
 *     computed under a different rule;
 *   • a period could see readings AFTER its own end — which would count a later week's miles into an
 *     earlier one.
 */
describe.each<Read>(["function", "paged"])("readFleetDistancePeriods (%s read)", (read) => {
  const WEEK2_FROM = "2026-07-13T00:00:00.000Z";
  const WEEK2_TO = "2026-07-20T00:00:00.000Z";

  it("gives each period exactly what a single-period read would have given it", async () => {
    const rows = [
      ...ONE_WEEK,
      row("v1", "2026-07-19T23:50:00Z", 664_609_344), // +804,672 m on week two = another 500 miles
    ];
    const one = await readFleetDistance(rec(rows, read).client, ORG, FROM, TO);
    const two = await readFleetDistance(rec(rows, read).client, ORG, WEEK2_FROM, WEEK2_TO);
    const batched = await readFleetDistancePeriods(rec(rows, read).client, ORG, [
      { fromIso: FROM, toIso: TO },
      { fromIso: WEEK2_FROM, toIso: WEEK2_TO },
    ]);
    expect(batched[0]).toEqual(one);
    expect(batched[1]).toEqual(two);
    expect(batched[1]!.miles).toBe(500); // not 1,000 — week one's driving stays in week one
  });

  it("asks the database once for all of them", async () => {
    const r = rec(ONE_WEEK, read);
    await readFleetDistancePeriods(r.client, ORG, [
      { fromIso: FROM, toIso: TO },
      { fromIso: WEEK2_FROM, toIso: WEEK2_TO },
    ]);
    if (read === "function") expect(r.rpcs().filter((c) => c.fn === "odometer_readings_for_periods")).toHaveLength(1);
    else expect(r.forTable("samsara_odometer_readings").length).toBe(1);
  });

  it("does not let a later period use an opening odometer older than its OWN lookback", async () => {
    // v9's only prior reading is 40 days before week two — outside its 30-day lookback, inside the
    // shared fetch's, because the fetch reaches back from week ONE. Read on its own, week two cannot
    // measure v9. The batch must agree, or the trend's weeks are not comparable with each other.
    const rows = [
      ...ONE_WEEK,
      row("v9", "2026-06-08T23:50:00Z", 500_000_000),
      row("v9", "2026-07-19T23:50:00Z", 500_804_672),
    ];
    const alone = await readFleetDistance(rec(rows, read).client, ORG, WEEK2_FROM, WEEK2_TO);
    const [, batched] = await readFleetDistancePeriods(rec(rows, read).client, ORG, [
      { fromIso: FROM, toIso: TO },
      { fromIso: WEEK2_FROM, toIso: WEEK2_TO },
    ]);
    expect(alone.perVehicle.find((v) => v.vehicleId === "v9")!.miles).toBeNull();
    expect(batched!.perVehicle.find((v) => v.vehicleId === "v9")!.miles).toBeNull();
  });

  it("counts readings per period, not the shared fetch's total", async () => {
    // `readings` is what a caller uses to tell "the collector has not run" from "the fleet stood
    // still". Answering it with another window's row count would answer a different question.
    const rows = [...ONE_WEEK, row("v1", "2026-07-19T23:50:00Z", 664_609_344)];
    const [w1, w2] = await readFleetDistancePeriods(rec(rows, read).client, ORG, [
      { fromIso: FROM, toIso: TO },
      { fromIso: WEEK2_FROM, toIso: WEEK2_TO },
    ]);
    expect(w1!.readings).toBe(3); // everything up to 12 July
    expect(w2!.readings).toBe(4); // …and the 19th as well
  });

  it("refuses a bad period even when the others are fine, and answers nothing for no periods", async () => {
    const r = rec(ONE_WEEK, read);
    await expect(
      readFleetDistancePeriods(r.client, ORG, [
        { fromIso: FROM, toIso: TO },
        { fromIso: TO, toIso: FROM },
      ]),
    ).rejects.toThrow(/ends before it starts/);
    expect(await readFleetDistancePeriods(r.client, ORG, [])).toEqual([]);
  });
});

/**
 * The two reads must answer every period identically (D-RLY6) — the function is a speed-up, never a
 * second definition. A deterministic irregular fleet: missed days, a parked fortnight, two counters,
 * readings exactly on a period's floor and on its start, and a weekly series plus a month, the
 * dashboard's own shape. Each pick the model makes is checked against Postgres in 0507's matrix.
 */
describe("the function read and the paged read agree", () => {
  it("gives the same miles, the same trucks, the same pairs and the same counts for every period", async () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const DAY = 86_400_000;
    const T0 = Date.parse("2026-05-01T00:00:00.000Z");
    const rows: ReadingFixture[] = [];
    for (let t = 0; t < 6; t++) {
      for (const source of t % 2 ? ["obd", "gps_distance"] : ["obd"]) {
        let m = 400_000_000 + t * 9_000_000;
        for (let d = 0; d < 110; d++) {
          if (t === 2 && d >= 50 && d < 64) continue;
          if (rnd() < 0.15) continue;
          m += Math.round(rnd() * 700_000);
          const exact = d === 40 || d === 70; // 40: a floor below; 70: a period's start
          // Rendered as Postgres renders a timestamptz — see odometerFunctionModel.ts for why it matters.
          const at = exact ? T0 + d * DAY : T0 + d * DAY + 21 * 3_600_000 + Math.round(rnd() * 2_000_000);
          rows.push(row(`v${t}`, pgInstant(at), m, source));
        }
      }
    }
    const periods = [0, 1, 2, 3, 4].map((w) => ({
      fromIso: new Date(T0 + (70 + 7 * w) * DAY).toISOString(),
      toIso: new Date(T0 + (77 + 7 * w) * DAY).toISOString(),
    }));
    periods.push({ fromIso: new Date(T0 + 70 * DAY).toISOString(), toIso: new Date(T0 + 105 * DAY).toISOString() });
    const viaFunction = await readFleetDistancePeriods(rec(rows, "function").client, ORG, periods);
    const viaPages = await readFleetDistancePeriods(rec(rows, "paged").client, ORG, periods);
    expect(viaFunction).toEqual(viaPages);
    expect(viaPages.every((p) => p.measuredVehicles > 0)).toBe(true);
  });
});
