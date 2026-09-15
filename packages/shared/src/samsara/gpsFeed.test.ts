import { describe, it, expect } from "vitest";
import { accumulateGpsFeedPage, latestGpsFix, type GpsFix } from "./core.js";
import type { StatsFeedPage } from "./statsFeed.js";

const at = (min: number) => new Date(Date.UTC(2026, 8, 15, 14, min, 0)).toISOString();

const page = (rows: unknown[]): StatsFeedPage => ({
  data: rows,
  pagination: { endCursor: "c", hasNextPage: true },
});

const gather = (...pages: StatsFeedPage[]): Map<string, GpsFix[]> => {
  const into = new Map<string, GpsFix[]>();
  for (const p of pages) accumulateGpsFeedPage(p, into);
  return into;
};

describe("reading positions off the Samsara delta feed", () => {
  it("keeps heading, the ECU-speed flag and the vendor's own place name", () => {
    const got = gather(
      page([
        {
          id: "sv-1",
          gps: [
            {
              time: at(0),
              latitude: 41.88,
              longitude: -87.63,
              headingDegrees: 275,
              speedMilesPerHour: 62.4,
              isEcuSpeed: true,
              reverseGeo: { formattedLocation: "Chicago, IL" },
            },
          ],
        },
      ]),
    );
    expect(got.get("sv-1")).toEqual([
      {
        time: at(0),
        lat: 41.88,
        lng: -87.63,
        headingDegrees: 275,
        speedMph: 62.4,
        isEcuSpeed: true,
        formattedLocation: "Chicago, IL",
      },
    ]);
  });

  // The map draws one marker per truck, so the reducer is where a multi-ping page is settled — and
  // the winner must be chosen by the VENDOR's time, not by arrival order.
  it("picks the newest fix when one page carries several for the same truck", () => {
    const got = gather(
      page([
        {
          id: "sv-1",
          gps: [
            { time: at(5), latitude: 41.0, longitude: -87.0 },
            { time: at(9), latitude: 41.9, longitude: -87.9 },
            { time: at(7), latitude: 41.5, longitude: -87.5 },
          ],
        },
      ]),
    );
    expect(latestGpsFix(got.get("sv-1")!)?.time).toBe(at(9));
    expect(latestGpsFix(got.get("sv-1")!)?.lat).toBe(41.9);
  });

  // The case a per-page reducer gets wrong: the truck's newest ping arrives on page ONE and an older
  // one on page two. Accumulating across the whole walk is the only thing that survives it.
  it("picks the newest fix across pages, not the last page that mentioned the truck", () => {
    const got = gather(
      page([{ id: "sv-1", gps: [{ time: at(30), latitude: 42.0, longitude: -88.0 }] }]),
      page([{ id: "sv-1", gps: [{ time: at(10), latitude: 40.0, longitude: -86.0 }] }]),
    );
    expect(latestGpsFix(got.get("sv-1")!)?.time).toBe(at(30));
  });

  it("drops a ping with no coordinate rather than drawing a truck at (0, 0)", () => {
    const got = gather(
      page([
        {
          id: "sv-1",
          gps: [
            { time: at(1), latitude: 41.0 }, // no longitude
            { time: at(2), longitude: -87.0 }, // no latitude
            { latitude: 41.0, longitude: -87.0 }, // no time
            { time: "not a date", latitude: 41.0, longitude: -87.0 },
            { time: at(3), latitude: 41.2, longitude: -87.2 },
          ],
        },
      ]),
    );
    expect(got.get("sv-1")).toHaveLength(1);
    expect(got.get("sv-1")![0]!.time).toBe(at(3));
  });

  // 0341's column is `[0, 360)`, so 360 is not a legal heading here either — it is the same bearing
  // as 0 and allowing both lets two writers disagree about a truck pointing north.
  it("refuses a heading outside [0, 360) instead of storing one the column would reject", () => {
    const got = gather(
      page([
        {
          id: "sv-1",
          gps: [{ time: at(1), latitude: 41.0, longitude: -87.0, headingDegrees: 360 }],
        },
        {
          id: "sv-2",
          gps: [{ time: at(1), latitude: 41.0, longitude: -87.0, headingDegrees: -4 }],
        },
        {
          id: "sv-3",
          gps: [{ time: at(1), latitude: 41.0, longitude: -87.0, headingDegrees: 359.9 }],
        },
      ]),
    );
    expect(got.get("sv-1")![0]!.headingDegrees).toBeNull();
    expect(got.get("sv-2")![0]!.headingDegrees).toBeNull();
    expect(got.get("sv-3")![0]!.headingDegrees).toBe(359.9);
  });

  // D-LM12's lesson, and the reason 0341 makes the column nullable: absent is not `false`. A ping with
  // no speed carries no claim about where a speed came from.
  it("leaves is_ecu_speed null when the ping carried no speed at all", () => {
    const got = gather(
      page([
        { id: "sv-1", gps: [{ time: at(1), latitude: 41.0, longitude: -87.0 }] },
        { id: "sv-2", gps: [{ time: at(1), latitude: 41.0, longitude: -87.0, speedMilesPerHour: 0 }] },
      ]),
    );
    expect(got.get("sv-1")![0]!.speedMph).toBeNull();
    expect(got.get("sv-1")![0]!.isEcuSpeed).toBeNull();
    // A parked truck reports 0 mph, which is a measurement — not a missing one.
    expect(got.get("sv-2")![0]!.speedMph).toBe(0);
    expect(got.get("sv-2")![0]!.isEcuSpeed).toBe(false);
  });

  it("ignores the snapshot shape, where `gps` is a single object rather than an array", () => {
    // Pointing this parser at `GET /fleet/vehicles/stats?types=gps` must yield nothing rather than
    // something wrong — `parseVehicleGpsSnapshots` is the parser for that payload.
    const got = gather(page([{ id: "sv-1", gps: { time: at(1), latitude: 41.0, longitude: -87.0 } }]));
    expect(got.size).toBe(0);
  });

  it("returns null for a truck the feed mentioned with no usable fix", () => {
    expect(latestGpsFix([])).toBeNull();
  });
});
