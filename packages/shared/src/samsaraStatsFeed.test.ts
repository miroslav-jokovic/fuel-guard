import { describe, it, expect } from "vitest";
import {
  findFuelLevelDrops,
  accumulateStatsFeedPage,
  latestOdometerMiles,
  latestFuelLevel,
  feedPageHasData,
  FUEL_DROP_MAX_GAP_MINUTES,
  type VehicleFeedSeries,
} from "./samsara/statsFeed.js";

/** 150-gal tank, so 10 percentage points = 15 gal = exactly the floor the tank rules already use. */
const CAP = 150;
const OPTS = { capacityGal: CAP, minGallons: 15 };
const at = (min: number) => new Date(Date.UTC(2026, 8, 1, 10, min, 0)).toISOString();

describe("findFuelLevelDrops — the event a snapshot poll structurally cannot see", () => {
  it("files a contiguous descent ONCE, on its total, not once per adjacent pair", () => {
    // 92 → 78 → 61 is one siphon observed three times. Three rows would put three partial
    // magnitudes in front of an operator instead of the one number that happened.
    const drops = findFuelLevelDrops(
      [
        { time: at(0), percent: 92 },
        { time: at(8), percent: 78 },
        { time: at(16), percent: 61 },
      ],
      OPTS,
    );
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ pctBefore: 92, pctAfter: 61, dropPct: 31 });
    expect(drops[0]!.gallons).toBeCloseTo(46.5, 1);
    expect(drops[0]!.startedAt).toBe(at(0));
    expect(drops[0]!.endedAt).toBe(at(16));
  });

  // THE DONE-WHEN, stated as a test. `vehicles.samsara_fuel_percent` holds ONE number, so under the
  // snapshot tier the second descent overwrites the first and only one of these two events survives.
  it("two separate descents between two polls produce TWO records, not one", () => {
    const drops = findFuelLevelDrops(
      [
        { time: at(0), percent: 90 },
        { time: at(5), percent: 70 }, // descent 1 — 20pp / 30 gal
        { time: at(10), percent: 95 }, // refuelled: breaks the run
        { time: at(15), percent: 72 }, // descent 2 — 23pp / 34.5 gal
      ],
      OPTS,
    );
    expect(drops).toHaveLength(2);
    expect(drops.map((d) => d.dropPct)).toEqual([20, 23]);
  });

  it("a descent broken by a plateau is still two events", () => {
    const drops = findFuelLevelDrops(
      [
        { time: at(0), percent: 90 },
        { time: at(5), percent: 68 },
        { time: at(10), percent: 68 }, // flat — not falling, so the run closes
        { time: at(15), percent: 45 },
      ],
      OPTS,
    );
    expect(drops).toHaveLength(2);
  });

  it("ignores a loss too small to be anything but sensor coarseness", () => {
    // 5pp of 150 gal = 7.5 gal, under the 15-gal floor.
    expect(findFuelLevelDrops([{ time: at(0), percent: 60 }, { time: at(10), percent: 55 }], OPTS)).toEqual([]);
  });

  it("refuses to attribute a shift's driving to an event — a gap past the window breaks the run", () => {
    const wide = FUEL_DROP_MAX_GAP_MINUTES + 1;
    const spanning = [
      { time: at(0), percent: 95 },
      { time: at(wide), percent: 40 }, // 55pp, way over the floor, but 31 minutes apart
    ];
    expect(findFuelLevelDrops(spanning, OPTS)).toEqual([]);
    // The identical magnitude INSIDE the window is a finding — so the window is what rejected it,
    // not the size.
    const inside = [
      { time: at(0), percent: 95 },
      { time: at(FUEL_DROP_MAX_GAP_MINUTES - 1), percent: 40 },
    ];
    expect(findFuelLevelDrops(inside, OPTS)).toHaveLength(1);
  });

  it("says nothing at all when the tank's volume is unknown — 12% of we-don't-know is not a finding", () => {
    const samples = [{ time: at(0), percent: 90 }, { time: at(5), percent: 50 }];
    // minGallons is 0 here ON PURPOSE. At the real floor an unknown capacity yields 0 gallons and is
    // rejected by the floor anyway, so the assertion would pass with the capacity guard deleted —
    // proving nothing. Dropping the floor makes the guard the only thing standing between "we do not
    // know how big this tank is" and a 40-point drop filed as a 0-gallon theft.
    expect(findFuelLevelDrops(samples, { capacityGal: 0, minGallons: 0 })).toEqual([]);
    expect(findFuelLevelDrops(samples, { capacityGal: -1, minGallons: 0 })).toEqual([]);
    expect(findFuelLevelDrops(samples, { capacityGal: Number.NaN, minGallons: 0 })).toEqual([]);
    // …and with a real capacity the same samples DO produce a finding, so it is the capacity that
    // rejected them and not the samples.
    expect(findFuelLevelDrops(samples, { capacityGal: CAP, minGallons: 0 })).toHaveLength(1);
  });

  it("sorts by time and discards unusable readings rather than coercing them", () => {
    const drops = findFuelLevelDrops(
      [
        { time: at(10), percent: 60 }, // out of order
        { time: at(0), percent: 90 },
        { time: "not-a-date", percent: 5 },
        { time: at(5), percent: 999 }, // impossible level
      ],
      OPTS,
    );
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ pctBefore: 90, pctAfter: 60 });
  });

  it("a rise is never a drop", () => {
    expect(findFuelLevelDrops([{ time: at(0), percent: 20 }, { time: at(5), percent: 95 }], OPTS)).toEqual([]);
  });
});

describe("accumulateStatsFeedPage — the feed's arrays, not the snapshot's singular objects", () => {
  const page = (rows: unknown[]) => ({ data: rows, pagination: { endCursor: "c", hasNextPage: true } });

  it("reads per-vehicle ARRAYS and merges them across pages", () => {
    // A descent that straddles a page boundary is one event; judging pages alone would split it.
    const acc = new Map<string, VehicleFeedSeries>();
    accumulateStatsFeedPage(
      page([{ id: "v1", fuelPercents: [{ time: at(0), value: 90 }], obdOdometerMeters: [{ time: at(0), value: 1609344 }] }]),
      acc,
    );
    accumulateStatsFeedPage(page([{ id: "v1", fuelPercents: [{ time: at(5), value: 60 }] }]), acc);

    expect(acc.get("v1")!.fuel).toHaveLength(2);
    expect(findFuelLevelDrops(acc.get("v1")!.fuel, OPTS)).toHaveLength(1);
    expect(latestOdometerMiles(acc.get("v1")!)).toBe(1000);
  });

  it("prefers OBD over GPS at the same instant, and never lets a later GPS-only page evict an OBD reading", () => {
    const acc = new Map<string, VehicleFeedSeries>();
    accumulateStatsFeedPage(
      page([{ id: "v1", obdOdometerMeters: [{ time: at(0), value: 1609344 }], gpsOdometerMeters: [{ time: at(0), value: 3218688 }] }]),
      acc,
    );
    expect(latestOdometerMiles(acc.get("v1")!)).toBe(1000); // OBD, not the 2000-mile GPS figure
  });

  it("takes the NEWEST reading when a later page carries one", () => {
    const acc = new Map<string, VehicleFeedSeries>();
    accumulateStatsFeedPage(page([{ id: "v1", obdOdometerMeters: [{ time: at(0), value: 1609344 }] }]), acc);
    accumulateStatsFeedPage(page([{ id: "v1", obdOdometerMeters: [{ time: at(30), value: 1770278 }] }]), acc);
    expect(latestOdometerMiles(acc.get("v1")!)).toBe(1100);
    expect(latestFuelLevel(acc.get("v1")!)).toBeNull(); // no fuel reported at all → not zero
  });

  it("survives the shapes a vendor actually sends — missing ids, non-array stats, junk samples", () => {
    const acc = new Map<string, VehicleFeedSeries>();
    accumulateStatsFeedPage(
      page([
        { fuelPercents: [{ time: at(0), value: 50 }] }, // no id → skipped entirely
        { id: "v2", fuelPercents: { time: at(0), value: 50 } }, // the SNAPSHOT shape → not an array
        { id: "v3", fuelPercents: [{ time: at(0) }, { value: 50 }, null, "x"] },
      ]),
      acc,
    );
    expect(acc.has("v2")).toBe(true);
    expect(acc.get("v2")!.fuel).toEqual([]);
    expect(acc.get("v3")!.fuel).toEqual([]);
    expect([...acc.keys()]).toEqual(["v2", "v3"]);
  });
});

describe("feedPageHasData — why hasNextPage cannot be the loop condition", () => {
  // Measured against the live feed 2026-09-01: hasNextPage was TRUE on all twelve pages walked,
  // including an immediate re-poll. The plan's §0.5 check 3 recorded false; it does not reproduce.
  it("an empty page ends the walk even though the vendor says there is a next page", () => {
    expect(feedPageHasData({ data: [], pagination: { endCursor: "c", hasNextPage: true } })).toBe(false);
    expect(feedPageHasData({ data: [{ id: "v1" }], pagination: { endCursor: "c", hasNextPage: false } })).toBe(true);
    expect(feedPageHasData({ pagination: { endCursor: "c", hasNextPage: true } })).toBe(false);
  });
});
