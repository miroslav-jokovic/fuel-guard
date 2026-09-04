import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { ODOMETER_SOURCE_WINDOW_DAYS, syncVehicleOdometerReadings } from "./samsaraOdometerSync.js";
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

const run = (
  rec: ReturnType<typeof seed>,
  fetcher: OdometerHistoryFetcher,
  options: { sinceDays?: number } = {},
) =>
  syncVehicleOdometerReadings(rec.client, ENV, ORG, {
    fetcherOverride: fetcher,
    endIso: END,
    ...options,
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
