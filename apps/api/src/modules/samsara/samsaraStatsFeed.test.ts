import { describe, it, expect } from "vitest";
import { syncVehicleStatsFromSamsara, STATS_FEED_MAX_PAGES } from "./samsaraStatsFeed.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";
import type { StatsFeedPage } from "@silvicom/shared";

const env = testEnv(); // a fetcher is injected, so no token / HTTP is reached
const ORG = "org-1";
const at = (min: number) => new Date(Date.UTC(2026, 8, 1, 10, min, 0)).toISOString();
const METERS = (miles: number) => miles * 1609.344;

/** A truck the learner trusts: reliable sensor, 150-gal capacity from the sensor, so 10pp = 15 gal. */
const RELIABLE = {
  id: "veh-1",
  samsara_vehicle_id: "sv-1",
  current_odometer: 900,
  samsara_fuel_percent: 90,
  samsara_fuel_at: at(-60),
  fuel_type: "diesel",
  tank_capacity_gal: 150,
  tank_sensor_reliable: true,
  sensor_capacity_gal: 150,
  observed_max_fill_gal: null,
  baseline_mpg: 6,
};

const page = (rows: unknown[], endCursor: string): StatsFeedPage => ({
  data: rows,
  // hasNextPage is TRUE here on purpose: that is what the live feed returns on every page, and a
  // walk that believed it would never stop.
  pagination: { endCursor, hasNextPage: true },
});
const EMPTY = (c: string): StatsFeedPage => ({ data: [], pagination: { endCursor: c, hasNextPage: true } });

/** Feeds the scripted pages in order, then empties. Records the `after` it was asked for. */
function scriptedFeed(pages: StatsFeedPage[]) {
  const asked: (string | undefined)[] = [];
  let i = 0;
  const fetcher = async (after?: string) => {
    asked.push(after);
    return pages[i++] ?? EMPTY("cursor-end");
  };
  return { fetcher, asked };
}

function recorder(vehicles: unknown[], opts: { cursor?: string | null; cursorError?: unknown } = {}) {
  return createSupabaseRecorder({
    tables: {
      samsara_feed_cursors:
        opts.cursorError !== undefined
          ? { data: null, error: opts.cursorError }
          : { data: opts.cursor ? [{ end_cursor: opts.cursor }] : [] },
      vehicles: { data: vehicles },
      fuel_events: { data: [] },
    },
  });
}

describe("the vehicle-stats delta feed — what a snapshot poll could never see", () => {
  it("resumes from the stored cursor rather than re-reading the feed's head", async () => {
    const { fetcher, asked } = scriptedFeed([page([{ id: "sv-1", fuelPercents: [{ time: at(5), value: 88 }] }], "c2")]);
    const rec = recorder([RELIABLE], { cursor: "c1" });
    const r = await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(asked[0]).toBe("c1");
    expect(r.resumed).toBe(true);
  });

  it("seeds from the feed's head when no cursor is stored, which is also what the deploy window gets", async () => {
    const { fetcher, asked } = scriptedFeed([page([{ id: "sv-1", fuelPercents: [{ time: at(5), value: 88 }] }], "c2")]);
    const rec = recorder([RELIABLE], { cursor: null });
    const r = await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(asked[0]).toBeUndefined();
    expect(r.resumed).toBe(false);
  });

  // The reader and its table ship in two merges, so for ~9 minutes the table is not there. That must
  // degrade to a seeded read, never to a failed tier.
  it("treats a missing cursor table as 'no cursor' instead of failing the tick", async () => {
    const { fetcher } = scriptedFeed([page([{ id: "sv-1", obdOdometerMeters: [{ time: at(5), value: METERS(1000) }] }], "c2")]);
    const rec = recorder([RELIABLE], { cursorError: { code: "42P01", message: 'relation "samsara_feed_cursors" does not exist' } });
    const r = await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.resumed).toBe(false);
    expect(r.updated).toBe(1); // the odometer still landed
  });

  it("stops on an EMPTY page, never on hasNextPage — which the live feed never sets false", async () => {
    const { fetcher, asked } = scriptedFeed([
      page([{ id: "sv-1", fuelPercents: [{ time: at(1), value: 90 }] }], "c2"),
      page([{ id: "sv-1", fuelPercents: [{ time: at(2), value: 89 }] }], "c3"),
      EMPTY("c4"),
    ]);
    const rec = recorder([RELIABLE]);
    const r = await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.pages).toBe(3); // two with data, then the empty one that ended it
    expect(asked).toEqual([undefined, "c2", "c3"]);
    expect(r.pagesCapped).toBe(false);
  });

  it("cannot spin forever on a vendor that never returns an empty page", async () => {
    let n = 0;
    const fetcher = async () => page([{ id: "sv-1", fuelPercents: [{ time: at(n), value: 90 }] }], `c${n++}`);
    const rec = recorder([RELIABLE]);
    const r = await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.pages).toBe(STATS_FEED_MAX_PAGES);
    expect(r.pagesCapped).toBe(true); // reported, not swallowed
  });

  it("advances the cursor only AFTER the page is applied — at-least-once, never at-most-once", async () => {
    const { fetcher } = scriptedFeed([page([{ id: "sv-1", obdOdometerMeters: [{ time: at(5), value: METERS(1000) }] }], "c9")]);
    const rec = recorder([RELIABLE]);
    await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });

    const order = rec.queries.map((q) => `${q.table}:${q.write?.method ?? "read"}`);
    const applied = order.indexOf("vehicles:update");
    const advanced = order.findIndex((o) => o.startsWith("samsara_feed_cursors:") && o !== "samsara_feed_cursors:read");
    expect(applied).toBeGreaterThanOrEqual(0);
    expect(advanced).toBeGreaterThan(applied);
  });

  it("a cursor it cannot store does not lose the samples it already applied", async () => {
    const { fetcher } = scriptedFeed([page([{ id: "sv-1", obdOdometerMeters: [{ time: at(5), value: METERS(1000) }] }], "c9")]);
    const rec = createSupabaseRecorder({
      tables: {
        samsara_feed_cursors: { data: [], writeError: { code: "42501", message: "denied" } },
        vehicles: { data: [RELIABLE] },
        fuel_events: { data: [] },
      },
    });
    const r = await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.updated).toBe(1); // the write happened; only the bookkeeping failed
  });

  it("still diffs before writing — a repeated value is not a write", async () => {
    // The truck already reads 90% at this exact instant, and 900 miles.
    const { fetcher } = scriptedFeed([
      page([{ id: "sv-1", fuelPercents: [{ time: at(-60), value: 90 }], obdOdometerMeters: [{ time: at(5), value: METERS(900) }] }], "c2"),
    ]);
    const rec = recorder([RELIABLE]);
    const r = await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.updated).toBe(0);
    expect(rec.queries.some((q) => q.table === "vehicles" && q.write)).toBe(false);
  });

  it("says nothing about a truck the feed did not mention", async () => {
    const { fetcher } = scriptedFeed([page([{ id: "sv-OTHER", fuelPercents: [{ time: at(5), value: 20 }] }], "c2")]);
    const rec = recorder([RELIABLE]);
    const r = await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.updated).toBe(0);
  });

  it("is org-scoped, like every other service-role read", async () => {
    const { fetcher } = scriptedFeed([page([{ id: "sv-1", fuelPercents: [{ time: at(5), value: 60 }] }], "c2")]);
    const rec = recorder([RELIABLE]);
    await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });
    expectOrgScoped(rec, ORG);
  });
});

describe("fuel-level drops — the columns 0021 has carried unwritten since it was merged", () => {
  it("files a drop with before AND after, which no producer has ever populated", async () => {
    const { fetcher } = scriptedFeed([
      page([{ id: "sv-1", fuelPercents: [{ time: at(0), value: 90 }, { time: at(6), value: 60 }] }], "c2"),
    ]);
    const rec = recorder([RELIABLE]);
    const r = await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.dropsFiled).toBe(1);

    const write = rec.queries.find((q) => q.table === "fuel_events" && q.write)!.write!;
    expect(write.method).toBe("insert");
    expect(write.payload).toMatchObject({
      org_id: ORG,
      vehicle_id: "veh-1",
      event_type: "fuel_drop",
      happened_at: at(6),
      fuel_pct_before: 90,
      fuel_pct_after: 60,
      drop_pct: 30,
    });
  });

  // The Done-when, at the service layer. `vehicles.samsara_fuel_percent` holds ONE number, so under
  // the snapshot tier the refill and the second descent erase the first event entirely.
  it("two descents between two polls produce TWO rows, not one", async () => {
    const { fetcher } = scriptedFeed([
      page(
        [{ id: "sv-1", fuelPercents: [
          { time: at(0), value: 90 }, { time: at(5), value: 60 },
          { time: at(10), value: 95 }, { time: at(15), value: 65 },
        ] }],
        "c2",
      ),
    ]);
    const rec = recorder([RELIABLE]);
    const r = await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.dropsFiled).toBe(2);
    expect(rec.queries.filter((q) => q.table === "fuel_events" && q.write)).toHaveLength(2);
  });

  it("a descent split across pages is ONE event, because pages accumulate before anything is judged", async () => {
    const { fetcher } = scriptedFeed([
      page([{ id: "sv-1", fuelPercents: [{ time: at(0), value: 90 }] }], "c2"),
      page([{ id: "sv-1", fuelPercents: [{ time: at(6), value: 60 }] }], "c3"),
    ]);
    const rec = recorder([RELIABLE]);
    const r = await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.dropsFiled).toBe(1);
  });

  it("re-delivery collides with the row it already wrote instead of doubling the queue", async () => {
    const { fetcher } = scriptedFeed([
      page([{ id: "sv-1", fuelPercents: [{ time: at(0), value: 90 }, { time: at(6), value: 60 }] }], "c2"),
    ]);
    const rec = createSupabaseRecorder({
      tables: {
        samsara_feed_cursors: { data: [] },
        vehicles: { data: [RELIABLE] },
        fuel_events: { data: [], writeError: { code: "23505", message: "duplicate key" } },
      },
    });
    const r = await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.dropsFiled).toBe(0); // the unique index absorbed it; the run did not fail
  });

  it("suppresses a drop on a sensor the learner does not trust, and COUNTS what it suppressed", async () => {
    const unreliable = { ...RELIABLE, tank_sensor_reliable: false };
    const { fetcher } = scriptedFeed([
      page([{ id: "sv-1", fuelPercents: [{ time: at(0), value: 90 }, { time: at(6), value: 55 }] }], "c2"),
    ]);
    const rec = recorder([unreliable]);
    const r = await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.dropsFiled).toBe(0);
    expect(r.dropsSuppressedUnreliableSensor).toBe(1);
    expect(rec.queries.some((q) => q.table === "fuel_events" && q.write)).toBe(false);
  });

  it("sizes the loss against the LEARNED capacity, not the entered one", async () => {
    // Entered says 100 gal, the sensor learned 300. A 10pp drop is 10 gal against the entered figure
    // — under the floor — and 30 gal against the learned one. resolveCapacity trusts the sensor when
    // it reads ABOVE the entered value, so this must file.
    const divergent = { ...RELIABLE, tank_capacity_gal: 100, sensor_capacity_gal: 300 };
    const { fetcher } = scriptedFeed([
      page([{ id: "sv-1", fuelPercents: [{ time: at(0), value: 80 }, { time: at(6), value: 70 }] }], "c2"),
    ]);
    const rec = recorder([divergent]);
    const r = await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.dropsFiled).toBe(1);
    expect((rec.queries.find((q) => q.table === "fuel_events" && q.write)!.write!.payload as { raw: { gallons: number } }).raw.gallons).toBe(30);
  });

  it("never emails — the webhook notifies, this does not, because the detector has not earned an alert", async () => {
    const { fetcher } = scriptedFeed([
      page([{ id: "sv-1", fuelPercents: [{ time: at(0), value: 90 }, { time: at(6), value: 60 }] }], "c2"),
    ]);
    const rec = recorder([RELIABLE]);
    await syncVehicleStatsFromSamsara(rec.client, env, ORG, { fetcher });
    // notifyFuelDrop reads `organizations` for notification_emails. Nothing here should touch it.
    expect(rec.queries.some((q) => q.table === "organizations")).toBe(false);
  });
});
