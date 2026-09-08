import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import {
  ODOMETER_CHUNK_DAYS,
  ODOMETER_SOURCE_WINDOW_DAYS,
  odometerSlices,
  syncVehicleOdometerReadings,
} from "./samsaraOdometerSync.js";
import type { OdometerHistoryFetcher } from "./lib/samsaraOdometer.js";

/**
 * The server side of the odometer pull. Which reading of a day survives is proved in
 * `packages/shared/src/samsara/odometerReadings.test.ts`; what is only testable here is everything
 * that makes the pull a RECORD rather than a fetch:
 *
 *   • it reads only this org's trucks — `admin` is the service role and bypasses RLS, so the
 *     `.eq("org_id", …)` is the only tenant boundary between one carrier's odometers and another's;
 *   • it writes METRES at Samsara's own instant, and never a distance (D-FLEET9);
 *   • a truck that reported nothing writes NO ROW and is COUNTED — a truck that did not report is
 *     not a truck that did not move, and a zero here would become a fleet denominator;
 *   • a truncated page walk stages NOTHING, because truncation removes exactly the readings this
 *     collector keeps and the rows it would still write look entirely healthy.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
/** `organizations` is read by primary key to resolve the day-boundary timezone — no org_id to scope by. */
const ORG_LOOKUP = ["organizations"];
const END = "2026-07-08T12:00:00.000Z";
const ENV = { SAMSARA_API_URL: "https://api.samsara.test" } as unknown as Parameters<
  typeof syncVehicleOdometerReadings
>[1];

const seed = (vehicles: { id: string; samsara_vehicle_id: string }[] = [
  { id: "v1", samsara_vehicle_id: "s-1" },
  { id: "v2", samsara_vehicle_id: "s-2" },
]) =>
  createSupabaseRecorder({
    tables: {
      vehicles,
      organizations: [{ id: ORG, operating_hours: { tz: "UTC" } }],
      samsara_odometer_readings: [],
    },
  });

/** A fetcher that answers with a fixed body and records what it was asked for. */
function fetcherFor(
  data: unknown[],
  opts: { complete?: boolean; pages?: number } = {},
): { fetcher: OdometerHistoryFetcher; calls: { ids: string[]; startIso: string; endIso: string }[] } {
  const calls: { ids: string[]; startIso: string; endIso: string }[] = [];
  const fetcher: OdometerHistoryFetcher = async (ids, startIso, endIso) => {
    calls.push({ ids, startIso, endIso });
    return {
      data: data as never,
      complete: opts.complete ?? true,
      pages: opts.pages ?? 1,
    };
  };
  return { fetcher, calls };
}

const TWO_TRUCKS = [
  {
    id: "s-1",
    obdOdometerMeters: [
      { time: "2026-07-06T13:02:00Z", value: 663_000_000 },
      { time: "2026-07-06T23:58:12Z", value: 663_428_113 },
      { time: "2026-07-07T22:10:00Z", value: 664_100_000 },
    ],
    gpsDistanceMeters: [{ time: "2026-07-07T22:11:00Z", value: 120_500_000 }],
  },
  {
    id: "s-2",
    // No ECU odometer at all — the fallback counter is the only thing this truck can be measured by.
    gpsDistanceMeters: [{ time: "2026-07-07T21:00:00Z", value: 44_000_000 }],
  },
];

/**
 * A fetcher that answers each SLICE differently, keyed by the slice's start instant.
 *
 * The fixed-body fetcher above cannot express the one thing a walked window makes possible: two
 * requests over two spans returning two different readings for the same calendar day.
 */
function slicedFetcher(byStart: Record<string, unknown[]>): {
  fetcher: OdometerHistoryFetcher;
  calls: { startIso: string; endIso: string }[];
} {
  const calls: { startIso: string; endIso: string }[] = [];
  const fetcher: OdometerHistoryFetcher = async (_ids, startIso, endIso) => {
    calls.push({ startIso, endIso });
    return { data: (byStart[startIso] ?? []) as never, complete: true, pages: 1 };
  };
  return { fetcher, calls };
}

const run = (
  rec: ReturnType<typeof seed>,
  fetcher: OdometerHistoryFetcher,
  options: { sinceDays?: number; chunkDays?: number } = {},
) =>
  syncVehicleOdometerReadings(rec.client, ENV, ORG, {
    fetcherOverride: fetcher,
    endIso: END,
    ...options,
  });

describe("odometerSlices", () => {
  const END_MS = Date.parse(END);
  const day = 86_400_000;

  it("returns one slice covering any window that fits in a chunk", () => {
    expect(odometerSlices(END_MS, 4, 7)).toEqual([
      { startIso: new Date(END_MS - 4 * day).toISOString(), endIso: END },
    ]);
  });

  it("covers a deep window exactly once, oldest first, with no gap and no overshoot", () => {
    const slices = odometerSlices(END_MS, 30, 7);
    expect(slices).toHaveLength(5); // 7+7+7+7+2
    expect(slices[0]!.startIso).toBe(new Date(END_MS - 30 * day).toISOString());
    expect(slices.at(-1)!.endIso).toBe(END);
    for (let i = 1; i < slices.length; i += 1) {
      expect(slices[i]!.startIso).toBe(slices[i - 1]!.endIso);
      expect(Date.parse(slices[i]!.startIso)).toBeGreaterThan(Date.parse(slices[i - 1]!.startIso));
    }
  });

  it("never asks for a span wider than the chunk, whatever the window", () => {
    for (const windowDays of [1, 7, 8, 30, 180, 400]) {
      for (const slice of odometerSlices(END_MS, windowDays, 7)) {
        expect(Date.parse(slice.endIso) - Date.parse(slice.startIso)).toBeLessThanOrEqual(7 * day);
      }
    }
  });

  it("still describes a degenerate window rather than reporting a sync that fetched nothing", () => {
    expect(odometerSlices(END_MS, 0, 7)).toEqual([{ startIso: END, endIso: END }]);
  });
});

describe("syncVehicleOdometerReadings", () => {
  it("scopes every tenant query to one organization", async () => {
    const rec = seed();
    const { fetcher } = fetcherFor(TWO_TRUCKS);
    await run(rec, fetcher);
    expectOrgScoped(rec, ORG, { exempt: ORG_LOOKUP });
  });

  it("stages the day's last reading, in metres, at Samsara's own instant", async () => {
    // A miles figure here would bake this month's conversion and day boundary into stored data, and
    // no later question about a week or a custom range could be answered without re-fetching.
    const rec = seed();
    const { fetcher } = fetcherFor(TWO_TRUCKS);
    await run(rec, fetcher);
    const rows = rec.writtenRows("samsara_odometer_readings");
    const july6 = rows.find((r) => r.vehicle_id === "v1" && r.day === "2026-07-06" && r.source === "obd")!;
    expect(july6).toMatchObject({
      org_id: ORG,
      meters: 663_428_113,
      reading_at: "2026-07-06T23:58:12Z",
      tz_offset_minutes: 0,
    });
    expect(Object.keys(july6)).not.toContain("miles");
  });

  it("keeps each counter as its own row — an ECU and a GPS counter are not the same number", async () => {
    // Their origins differ (the engine's life vs the gateway's install), so a subtraction across
    // them means nothing; keeping both is what lets a truck with a broken ECU fall back.
    const rec = seed();
    const { fetcher } = fetcherFor(TWO_TRUCKS);
    const res = await run(rec, fetcher);
    const rows = rec.writtenRows("samsara_odometer_readings");
    expect(rows.filter((r) => r.vehicle_id === "v1" && r.source === "obd")).toHaveLength(2);
    expect(rows.filter((r) => r.vehicle_id === "v1" && r.source === "gps_distance")).toHaveLength(1);
    expect(rows.filter((r) => r.vehicle_id === "v2")).toEqual([
      expect.objectContaining({ source: "gps_distance", meters: 44_000_000, day: "2026-07-07" }),
    ]);
    expect(res).toMatchObject({ obdReadings: 2, gpsDistanceReadings: 2, readings: 4 });
  });

  it("counts a truck that reported nothing, and writes no row for it", async () => {
    // A truck Samsara has no history for is not a truck that stood still. A zero row would enter a
    // fleet denominator as a measured mile and read entirely plausibly.
    const rec = seed();
    const { fetcher } = fetcherFor([TWO_TRUCKS[0]]);
    const res = await run(rec, fetcher);
    expect(res).toMatchObject({ vehicles: 2, vehiclesWithData: 1, vehiclesWithoutData: 1 });
    expect(rec.writtenRows("samsara_odometer_readings").some((r) => r.vehicle_id === "v2")).toBe(false);
  });

  it("refuses to stage anything when the page walk was truncated", async () => {
    // Truncation is not an even thinning here: it drops the END of the window, which is precisely
    // the reading the collector keeps. The rows it would still write look healthy and report an
    // earlier odometer, so the job must fail loudly instead.
    const rec = seed();
    const { fetcher } = fetcherFor(TWO_TRUCKS, { complete: false, pages: 120 });
    await expect(run(rec, fetcher)).rejects.toThrow(/truncated after 120 pages/);
    expect(rec.writtenRows("samsara_odometer_readings")).toHaveLength(0);
  });

  it("asks Samsara for the rolling window, and a wider one when told to", async () => {
    const rec = seed();
    const { fetcher, calls } = fetcherFor(TWO_TRUCKS);
    await run(rec, fetcher);
    expect(calls[0]!.endIso).toBe(END);
    expect(calls[0]!.startIso).toBe(
      new Date(Date.parse(END) - ODOMETER_SOURCE_WINDOW_DAYS * 86_400_000).toISOString(),
    );

    const backfill = seed();
    const wide = fetcherFor(TWO_TRUCKS);
    const res = await run(backfill, wide.fetcher, { sinceDays: 30 });
    expect(wide.calls[0]!.startIso).toBe(
      new Date(Date.parse(END) - 30 * 86_400_000).toISOString(),
    );
    expect(res.windowDays).toBe(30);
  });

  it("batches the fleet twenty trucks at a time", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `v${i}`,
      samsara_vehicle_id: `s-${i}`,
    }));
    const rec = seed(many);
    const { fetcher, calls } = fetcherFor([]);
    const res = await run(rec, fetcher);
    expect(calls.map((c) => c.ids.length)).toEqual([20, 5]);
    expect(res.batches).toBe(2);
  });

  it("cuts the day slot on the fleet's operating clock, not the server's", async () => {
    // 04:30Z on the 7th is 23:30 on the 6th in Chicago. Bucketing on UTC would move a night's
    // driving into the next period, and the offset in force is recorded so the cut stays checkable.
    const rec = createSupabaseRecorder({
      tables: {
        vehicles: [{ id: "v1", samsara_vehicle_id: "s-1" }],
        organizations: [{ id: ORG, operating_hours: { tz: "America/Chicago" } }],
        samsara_odometer_readings: [],
      },
    });
    const { fetcher } = fetcherFor([
      { id: "s-1", obdOdometerMeters: [{ time: "2026-07-07T04:30:00Z", value: 1_000 }] },
    ]);
    await run(rec, fetcher);
    expect(rec.writtenRows("samsara_odometer_readings")[0]).toMatchObject({
      day: "2026-07-06",
      tz_offset_minutes: -300,
    });
  });

  it("calls the vendor not at all when the fleet has no Samsara-linked trucks", async () => {
    const rec = seed([]);
    const { fetcher, calls } = fetcherFor(TWO_TRUCKS);
    const res = await run(rec, fetcher);
    expect(calls).toHaveLength(0);
    expect(res).toMatchObject({ vehicles: 0, readings: 0, batches: 0 });
  });

  it("walks a deep window in slices, oldest first, and asks for the whole of it", async () => {
    // Before 2026-09-08 a deep window was one request, and 180 days of it would have held roughly
    // four million events in memory before a row was staged. `chunkDays` is passed explicitly so the
    // walk is proved over a window small enough to enumerate.
    const rec = seed([{ id: "v1", samsara_vehicle_id: "s-1" }]);
    const { fetcher, calls } = fetcherFor([]);
    const res = await run(rec, fetcher, { sinceDays: 6, chunkDays: 2 });

    const day = 86_400_000;
    expect(calls.map((c) => c.startIso)).toEqual([
      new Date(Date.parse(END) - 6 * day).toISOString(),
      new Date(Date.parse(END) - 4 * day).toISOString(),
      new Date(Date.parse(END) - 2 * day).toISOString(),
    ]);
    // Contiguous, and the last slice lands exactly on the window's end rather than past it.
    expect(calls.map((c) => c.endIso).slice(0, -1)).toEqual(calls.map((c) => c.startIso).slice(1));
    expect(calls.at(-1)!.endIso).toBe(END);
    // One batch of trucks, three requests — the two numbers the ledger keeps apart.
    expect(res).toMatchObject({ batches: 1, chunks: 3, fetches: 3, chunkDays: 2 });
  });

  it("keeps the rolling window a single request, so the hourly tier is unchanged", async () => {
    // The walk exists for backfills. If the tier's own four days started costing two requests, this
    // feature would have quietly become a change to the thing that runs every hour.
    expect(ODOMETER_SOURCE_WINDOW_DAYS).toBeLessThanOrEqual(ODOMETER_CHUNK_DAYS);
    const rec = seed();
    const { fetcher, calls } = fetcherFor(TWO_TRUCKS);
    const res = await run(rec, fetcher);
    expect(calls).toHaveLength(1);
    expect(res).toMatchObject({ chunks: 1, fetches: 1, batches: 1 });
  });

  it("a day split across two slices keeps the later reading", async () => {
    // The slice boundary falls at midday on the 6th, and `lastReadingEachDay` keeps the last reading
    // of each day IT WAS GIVEN — so the older slice stages 10:00's counter for that day and the
    // newer stages 20:00's. Both upsert to the same (org, vehicle, source, day) key, so the LAST
    // write wins. Oldest-first makes that the later, higher, correct odometer; reverse the walk and
    // this row silently becomes an earlier reading, which is the undercount the lookback rule exists
    // to prevent arriving through the back door.
    const rec = seed([{ id: "v1", samsara_vehicle_id: "s-1" }]);
    const day = 86_400_000;
    const older = new Date(Date.parse(END) - 4 * day).toISOString();
    const newer = new Date(Date.parse(END) - 2 * day).toISOString();
    const { fetcher } = slicedFetcher({
      [older]: [{ id: "s-1", obdOdometerMeters: [{ time: "2026-07-06T10:00:00Z", value: 100 }] }],
      [newer]: [{ id: "s-1", obdOdometerMeters: [{ time: "2026-07-06T20:00:00Z", value: 500 }] }],
    });
    await run(rec, fetcher, { sinceDays: 4, chunkDays: 2 });

    const july6 = rec
      .writtenRows("samsara_odometer_readings")
      .filter((r) => r.vehicle_id === "v1" && r.source === "obd" && r.day === "2026-07-06");
    expect(july6.at(-1)).toMatchObject({ meters: 500, reading_at: "2026-07-06T20:00:00Z" });
  });

  it("stages each slice as it lands, so a walk that dies keeps what it already collected", async () => {
    // 180 days is twenty-six requests per batch. Writing once at the end would mean a failure at the
    // twenty-first discarded the twenty that had already been fetched and paid for.
    const rec = seed([{ id: "v1", samsara_vehicle_id: "s-1" }]);
    let seen = 0;
    const fetcher: OdometerHistoryFetcher = async () => {
      seen += 1;
      if (seen === 2) throw new Error("Samsara API 503");
      return {
        data: [
          { id: "s-1", obdOdometerMeters: [{ time: "2026-07-03T09:00:00Z", value: 7_000 }] },
        ] as never,
        complete: true,
        pages: 1,
      };
    };
    await expect(run(rec, fetcher, { sinceDays: 6, chunkDays: 2 })).rejects.toThrow("503");
    expect(seen).toBe(2);
    expect(rec.writtenRows("samsara_odometer_readings")).toHaveLength(1);
  });

  it("names the slice when a page walk is truncated, and stages nothing for it", async () => {
    const rec = seed([{ id: "v1", samsara_vehicle_id: "s-1" }]);
    const { fetcher } = fetcherFor(TWO_TRUCKS, { complete: false, pages: 120 });
    await expect(run(rec, fetcher, { sinceDays: 6, chunkDays: 2 })).rejects.toThrow(
      /truncated after 120 pages .* over .*; no readings were staged for this slice/,
    );
    expect(rec.writtenRows("samsara_odometer_readings")).toHaveLength(0);
  });

  it("counts a truck that reported in ANY slice as measured, not once per request", async () => {
    // `vehiclesWithoutData` is the coverage story behind every per-mile figure, and it is a question
    // about the WINDOW. Counting per request would report one truck as three unmeasured ones.
    const rec = seed([{ id: "v1", samsara_vehicle_id: "s-1" }]);
    const day = 86_400_000;
    const middle = new Date(Date.parse(END) - 4 * day).toISOString();
    const { fetcher } = slicedFetcher({
      [middle]: [{ id: "s-1", obdOdometerMeters: [{ time: "2026-07-05T09:00:00Z", value: 42 }] }],
    });
    const res = await run(rec, fetcher, { sinceDays: 6, chunkDays: 2 });
    expect(res).toMatchObject({ vehicles: 1, vehiclesWithData: 1, vehiclesWithoutData: 0 });
  });

  it("upserts on the reading's identity, so re-collecting a window converges", async () => {
    // The day in progress has a "last reading so far" that the next run replaces. Anything other
    // than (org, vehicle, source, day) here would either duplicate the day or overwrite a counter.
    const rec = seed();
    const { fetcher } = fetcherFor(TWO_TRUCKS);
    await run(rec, fetcher);
    const write = rec.forTable("samsara_odometer_readings").find((q) => q.write?.method === "upsert")!;
    expect(write.ops.find((o) => o.method === "upsert")!.args[1]).toEqual({
      onConflict: "org_id,vehicle_id,source,day",
    });
  });
});
