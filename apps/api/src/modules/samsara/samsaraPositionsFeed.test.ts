import { describe, it, expect } from "vitest";
import { syncVehiclePositionsFromSamsara, POSITIONS_FEED_MAX_PAGES } from "./samsaraPositionsFeed.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";
import type { StatsFeedPage } from "@silvicom/shared";

const env = testEnv(); // a fetcher is injected, so no token / HTTP is reached
const ORG = "org-1";
const at = (min: number) => new Date(Date.UTC(2026, 8, 15, 14, min, 0)).toISOString();

const TRUCK = { id: "veh-1", samsara_vehicle_id: "sv-1" };
const TRUCK_2 = { id: "veh-2", samsara_vehicle_id: "sv-2" };

const gps = (o: Record<string, unknown>) => ({ latitude: 41.88, longitude: -87.63, ...o });

const page = (rows: unknown[], endCursor: string): StatsFeedPage => ({
  data: rows,
  // `hasNextPage: true` on every page, which is what the live feed actually returns — a walk that
  // believed it would never stop.
  pagination: { endCursor, hasNextPage: true },
});
const EMPTY = (c: string): StatsFeedPage => ({ data: [], pagination: { endCursor: c, hasNextPage: true } });

/** Feeds the scripted pages in order, then empties forever. Records the `after` it was asked for. */
function scriptedFeed(pages: StatsFeedPage[]) {
  const asked: (string | undefined)[] = [];
  let i = 0;
  const fetcher = async (after?: string) => {
    asked.push(after);
    return pages[i++] ?? EMPTY("cursor-end");
  };
  return { fetcher, asked };
}

function recorder(
  vehicles: unknown[],
  opts: { cursor?: string | null; written?: number; rpcError?: unknown } = {},
) {
  return createSupabaseRecorder({
    tables: {
      samsara_feed_cursors: { data: opts.cursor ? [{ end_cursor: opts.cursor }] : [] },
      vehicles: { data: vehicles },
    },
    // The recorder wraps a bare fixture as `{ data, error: null }`, so the success case is the plain
    // row count the function returns; a scripted `{ error }` passes through as a failed call.
    rpc: {
      record_vehicle_positions:
        opts.rpcError !== undefined ? { error: opts.rpcError } : (opts.written ?? 1),
    },
  });
}

/** The payload handed to `record_vehicle_positions` on the one call the tier makes. */
const rpcRows = (rec: ReturnType<typeof recorder>) =>
  (rec.rpcs()[0]?.args as { p_org: string; p_rows: Record<string, unknown>[] } | undefined);

describe("the live-map positions tier", () => {
  it("writes the newest fix per truck, with heading, speed and the vendor's place name", async () => {
    const { fetcher } = scriptedFeed([
      page(
        [
          {
            id: "sv-1",
            gps: [
              gps({ time: at(1), headingDegrees: 90, speedMilesPerHour: 55, isEcuSpeed: true }),
              gps({
                time: at(4),
                latitude: 41.9,
                longitude: -87.7,
                headingDegrees: 275,
                speedMilesPerHour: 62,
                isEcuSpeed: true,
                reverseGeo: { formattedLocation: "Chicago, IL" },
              }),
            ],
          },
        ],
        "c2",
      ),
    ]);
    const rec = recorder([TRUCK], { written: 1 });
    const r = await syncVehiclePositionsFromSamsara(rec.client, env, ORG, { fetcher });

    const args = rpcRows(rec)!;
    expect(args.p_org).toBe(ORG); // tenant scope is the ARGUMENT, never a value inside a row
    expect(args.p_rows).toEqual([
      {
        vehicle_id: "veh-1",
        lat: 41.9,
        lng: -87.7,
        heading_degrees: 275,
        speed_mph: 62,
        is_ecu_speed: true,
        formatted_location: "Chicago, IL",
        sampled_at: at(4),
      },
    ]);
    expect(r.written).toBe(1);
    expect(r.fixes).toBe(2);
    expectOrgScoped(rec, ORG);
  });

  // The failure a per-page reducer produces, and the reason the walk accumulates before it reduces.
  it("keeps the newest fix when it arrived on an EARLIER page than an older one", async () => {
    const { fetcher } = scriptedFeed([
      page([{ id: "sv-1", gps: [gps({ time: at(30) })] }], "c2"),
      page([{ id: "sv-1", gps: [gps({ time: at(10) })] }], "c3"),
    ]);
    const rec = recorder([TRUCK]);
    await syncVehiclePositionsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(rpcRows(rec)!.p_rows).toHaveLength(1);
    expect(rpcRows(rec)!.p_rows[0]!.sampled_at).toBe(at(30));
  });

  it("stops on an EMPTY page, never on hasNextPage — which this feed never sets false", async () => {
    const { fetcher, asked } = scriptedFeed([
      page([{ id: "sv-1", gps: [gps({ time: at(1) })] }], "c2"),
      page([{ id: "sv-1", gps: [gps({ time: at(2) })] }], "c3"),
      EMPTY("c4"),
    ]);
    const rec = recorder([TRUCK]);
    const r = await syncVehiclePositionsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.pages).toBe(3); // two with data, then the empty one that ended the walk
    expect(r.pagesCapped).toBe(false);
    expect(asked).toEqual([undefined, "c2", "c3"]);
  });

  // The guard against a vendor that never returns an empty page. Without it the tick never returns and
  // the scheduler's `running` flag stays set, so the tier stops forever without failing.
  it("terminates at the page cap when every page has data and hasNextPage stays true", async () => {
    let n = 0;
    const fetcher = async () => page([{ id: "sv-1", gps: [gps({ time: at(1) })] }], `c${++n}`);
    const rec = recorder([TRUCK]);
    const r = await syncVehiclePositionsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.pages).toBe(POSITIONS_FEED_MAX_PAGES);
    expect(r.pagesCapped).toBe(true);
  });

  it("resumes from the stored cursor and advances it only after the fixes are written", async () => {
    const { fetcher, asked } = scriptedFeed([page([{ id: "sv-1", gps: [gps({ time: at(1) })] }], "c2")]);
    const rec = recorder([TRUCK], { cursor: "c1" });
    const r = await syncVehiclePositionsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(asked[0]).toBe("c1");
    expect(r.resumed).toBe(true);
    const cursorWrites = rec
      .forTable("samsara_feed_cursors")
      .filter((q) => q.ops.some((o) => o.method === "update"));
    expect(cursorWrites).toHaveLength(1);
  });

  // The deploy window: Railway serves the merge before `migrate.yml` applies 0342. A tick inside it
  // must lose nothing — which means it must NOT store a cursor it never applied a page for.
  it("does not advance the cursor when the writer function is not in the database yet", async () => {
    const { fetcher } = scriptedFeed([page([{ id: "sv-1", gps: [gps({ time: at(1) })] }], "c2")]);
    const rec = recorder([TRUCK], {
      rpcError: { code: "PGRST202", message: "Could not find the function public.record_vehicle_positions" },
    });
    const r = await syncVehiclePositionsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.writerMissing).toBe(true);
    expect(r.written).toBe(0);
    const cursorWrites = rec
      .forTable("samsara_feed_cursors")
      .filter((q) => q.ops.some((o) => o.method === "update" || o.method === "insert"));
    expect(cursorWrites).toHaveLength(0);
  });

  it("raises any OTHER write failure rather than reporting a quiet successful tick", async () => {
    const { fetcher } = scriptedFeed([page([{ id: "sv-1", gps: [gps({ time: at(1) })] }], "c2")]);
    const rec = recorder([TRUCK], { rpcError: { code: "23514", message: "check constraint violated" } });
    await expect(syncVehiclePositionsFromSamsara(rec.client, env, ORG, { fetcher })).rejects.toThrow(
      /check constraint/,
    );
  });

  // `vehicles` is roster-owned (D-ARC3). A GPS ping is not authority to create one.
  it("counts a truck Samsara knows and the roster does not, and creates nothing", async () => {
    const { fetcher } = scriptedFeed([
      page(
        [
          { id: "sv-1", gps: [gps({ time: at(1) })] },
          { id: "sv-99", gps: [gps({ time: at(1) })] },
        ],
        "c2",
      ),
    ]);
    const rec = recorder([TRUCK]);
    const r = await syncVehiclePositionsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.unmappedVehicles).toBe(1);
    expect(rpcRows(rec)!.p_rows).toHaveLength(1);
    expect(rec.writtenRows("vehicles")).toHaveLength(0);
  });

  it("makes no write at all when the feed had nothing to say", async () => {
    const { fetcher } = scriptedFeed([EMPTY("c2")]);
    const rec = recorder([TRUCK, TRUCK_2]);
    const r = await syncVehiclePositionsFromSamsara(rec.client, env, ORG, { fetcher });
    expect(r.fixes).toBe(0);
    expect(r.written).toBe(0);
    expect(rec.rpcs()).toHaveLength(0);
  });
});
