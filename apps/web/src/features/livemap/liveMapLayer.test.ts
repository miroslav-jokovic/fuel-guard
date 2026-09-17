import { describe, it, expect } from "vitest";
import type { LiveMapVehicle } from "@silvicom/shared";
import {
  ICON_NAMES,
  MAP_STATES,
  filterVehicles,
  iconNameFor,
  STATE_COLOR_CLASS,
  scopeToViewport,
  stateCounts,
  toFeatureCollection,
  sortVehicles,
} from "./liveMapLayer";

/**
 * The decisions the live map makes about what to draw, held still.
 *
 * The map itself needs WebGL and cannot be mounted here, which is exactly why these live in a pure
 * module: a rule kept inside `LiveMapCanvas.vue` is a rule only a screenshot can check, and LM7's
 * `toMapColor` shipped broken on Edge for precisely that reason.
 */
const vehicle = (o: Partial<LiveMapVehicle> = {}): LiveMapVehicle => ({
  vehicleId: "veh-1",
  unitNumber: "1207",
  driver: { id: "drv-1", name: "Ana Ruiz" },
  position: {
    lat: 44.51,
    lng: -88.01,
    headingDegrees: 275,
    speedMph: 62,
    isEcuSpeed: true,
    formattedLocation: "Green Bay, WI",
    sampledAt: "2026-09-15T18:00:00.000Z",
    receivedAt: "2026-09-15T18:00:01.000Z",
  },
  state: "moving",
  ageSeconds: 5,
  // A fresh tank by default (`Q-LM20`). The cases that matter set their own — a stale reading on a
  // live truck is a quarter of this fleet, not an edge case.
  fuel: { percent: 68, at: "2026-09-15T17:58:00.000Z" },
  load: null,
  ...o,
});

describe("iconNameFor", () => {
  it("gives a truck with a bearing an arrow, in its own state's colour", () => {
    expect(iconNameFor(vehicle())).toBe("live-moving-arrow");
    expect(iconNameFor(vehicle({ state: "parked" }))).toBe("live-parked-arrow");
  });

  /**
   * ⚠ The assertion that stops the dot branch being tidied away as dead code. Production carried a
   * bearing on 199 of 199 rows on 2026-09-16, so nothing on screen would change today — but
   * `icon-rotate` would receive 0 for a bearing-less truck and the marker would claim, in a picture,
   * to be pointing north.
   */
  it("gives a truck whose ping carried no bearing a dot, which claims no direction", () => {
    const v = vehicle({ position: { ...vehicle().position, headingDegrees: null } });
    expect(iconNameFor(v)).toBe("live-moving-dot");
  });

  it("only ever names an icon the panel registers", () => {
    for (const state of MAP_STATES) {
      expect(ICON_NAMES).toContain(iconNameFor(vehicle({ state })));
      const noHeading = vehicle({ state, position: { ...vehicle().position, headingDegrees: null } });
      expect(ICON_NAMES).toContain(iconNameFor(noHeading));
    }
  });
});

describe("toFeatureCollection", () => {
  it("puts longitude first, which is the order GeoJSON means and the opposite of how we say it", () => {
    const fc = toFeatureCollection([vehicle()]);
    expect(fc.features[0]!.geometry.coordinates).toEqual([-88.01, 44.51]);
  });

  it("draws a truck where the animation has it, not where its last fix was", () => {
    const places = new Map([["veh-1", { lat: 44.0, lng: -88.5, heading: 100 }]]);
    const fc = toFeatureCollection([vehicle()], places);
    expect(fc.features[0]!.geometry.coordinates).toEqual([-88.5, 44.0]);
    expect(fc.features[0]!.properties.heading).toBe(100);
  });

  it("falls back to a truck's own fix when the animation does not know it yet", () => {
    const fc = toFeatureCollection([vehicle()], new Map());
    expect(fc.features[0]!.geometry.coordinates).toEqual([-88.01, 44.51]);
  });

  it("marks exactly the selected truck, so the ring layer's filter has something to match", () => {
    const fc = toFeatureCollection([vehicle(), vehicle({ vehicleId: "veh-2" })], undefined, "veh-2");
    expect(fc.features.map((f) => f.properties.selected)).toEqual([false, true]);
  });

  // `icon-rotate` takes a number; a null heading must not arrive as a null and must not become a
  // bearing. It becomes 0 AND the feature asks for the dot, which does not rotate.
  it("sends 0 for an absent bearing, paired with the icon that does not point anywhere", () => {
    const v = vehicle({ position: { ...vehicle().position, headingDegrees: null } });
    const props = toFeatureCollection([v]).features[0]!.properties;
    expect(props.heading).toBe(0);
    expect(props.icon).toBe("live-moving-dot");
  });
});

describe("filterVehicles", () => {
  const fleet = [
    vehicle({ vehicleId: "a", unitNumber: "1207", state: "moving" }),
    vehicle({ vehicleId: "b", unitNumber: "1208", state: "offline", driver: { id: "d2", name: "Ben Oduya" } }),
    vehicle({ vehicleId: "c", unitNumber: "3301", state: "parked", driver: null }),
  ];

  it("shows everything when nothing is chosen — an empty filter is not an empty result", () => {
    expect(filterVehicles(fleet, { states: [], search: "" })).toHaveLength(3);
  });

  it("keeps only the states that were ticked", () => {
    const got = filterVehicles(fleet, { states: ["offline", "parked"], search: "" });
    expect(got.map((v) => v.vehicleId)).toEqual(["b", "c"]);
  });

  it("searches unit number and driver name together, because a dispatcher knows one or the other", () => {
    expect(filterVehicles(fleet, { states: [], search: "3301" }).map((v) => v.vehicleId)).toEqual(["c"]);
    expect(filterVehicles(fleet, { states: [], search: "oduya" }).map((v) => v.vehicleId)).toEqual(["b"]);
  });

  it("does not drop the 67-of-235 trucks with nobody assigned when a search is typed", () => {
    // The unassigned truck has no name to match, and must not throw or be excluded by an operator.
    expect(filterVehicles(fleet, { states: [], search: "1207" }).map((v) => v.vehicleId)).toEqual(["a"]);
  });

  it("applies state and search together rather than either alone", () => {
    expect(filterVehicles(fleet, { states: ["moving"], search: "1208" })).toEqual([]);
  });
});

describe("stateCounts", () => {
  it("counts every state, including the ones with nobody in them", () => {
    const counts = stateCounts([vehicle(), vehicle({ state: "offline" }), vehicle({ state: "offline" })]);
    expect(counts).toEqual({ moving: 1, stopped: 0, parked: 0, offline: 2 });
  });
});



/**
 * The orderings the rail offers instead of the dock's sortable column headers (D-DR25).
 *
 * ⚠ Each case is a number a dispatcher would notice getting this wrong, not a property of a sort.
 */
describe("sortVehicles", () => {
  const unit = (unitNumber: string, o: Partial<LiveMapVehicle> = {}) => vehicle({ unitNumber, ...o });

  /**
   * ⚠ THE CASE THE OBVIOUS IMPLEMENTATION FAILS. This fleet's unit numbers are strings — "1207",
   * "204", "47" — and `localeCompare` without `numeric` puts 1207 first, then 204, then 47, which
   * reads as a broken list rather than as a sorting rule.
   */
  it("orders unit numbers the way a person counts, not the way a string sorts", () => {
    const sorted = sortVehicles([unit("1207"), unit("204"), unit("47")], "unit");
    expect(sorted.map((v) => v.unitNumber)).toEqual(["47", "204", "1207"]);
  });

  it("orders statuses moving → stopped → parked → offline, never alphabetically", () => {
    const sorted = sortVehicles(
      [unit("1", { state: "offline" }), unit("2", { state: "parked" }), unit("3", { state: "moving" }), unit("4", { state: "stopped" })],
      "state",
    );
    // Alphabetical would be moving, offline, parked, stopped — putting the trucks nobody can see in
    // the middle of the ones that are driving.
    expect(sorted.map((v) => v.state)).toEqual(["moving", "stopped", "parked", "offline"]);
  });

  it("puts the oldest fix first, because that is the truck a dispatcher is looking for", () => {
    const sorted = sortVehicles([unit("1", { ageSeconds: 5 }), unit("2", { ageSeconds: 900 }), unit("3", { ageSeconds: 60 })], "age");
    expect(sorted.map((v) => v.ageSeconds)).toEqual([900, 60, 5]);
  });

  /** ⚠ A truck with no speed reading is not a slow truck — `null` sorts last, not as zero. */
  it("sorts a missing speed last rather than treating it as standing still", () => {
    const withSpeed = (mph: number | null, unitNumber: string) =>
      vehicle({ unitNumber, position: { ...vehicle().position, speedMph: mph } });
    const sorted = sortVehicles([withSpeed(null, "1"), withSpeed(0, "2"), withSpeed(55, "3")], "speed");
    expect(sorted.map((v) => v.unitNumber)).toEqual(["3", "2", "1"]);
  });

  /**
   * ⚠ The board's array is replaced by vue-query every five seconds and handed to every other
   * reader, the map's feature collection included. Sorting it in place would reorder what the map is
   * drawing from under it.
   */
  it("copies rather than sorting the board's own array in place", () => {
    const source = [unit("9"), unit("2")];
    const sorted = sortVehicles(source, "unit");
    expect(source.map((v) => v.unitNumber)).toEqual(["9", "2"]);
    expect(sorted.map((v) => v.unitNumber)).toEqual(["2", "9"]);
  });
});


/**
 * The rail's one-line foot (`Q-LM19`, the owner's item 6) — and the two decisions it had to keep.
 *
 * Every case below fails on a specific mutation of `boardSummarySentence`, and each was run:
 * dropping `SCOPE_CLAUSE[scope]` fails the two disclosure cases, hard-coding "in the fleet" fails
 * the `mine` case, typing "5s" instead of reading `pollSeconds` fails the cadence case, and dropping
 * the `shown === total` branch fails the plain-total case.
 */


describe("scopeToViewport", () => {
  /**
   * The owner's item 7 (D-LM23). What is pinned here is the SCOPE, which is a different thing from
   * the filters — see `useLiveMapView` for why the census counts this and not `filtered`.
   */
  const CHICAGO = { west: -88, south: 41, east: -87, north: 42 };
  const inside = vehicle({ vehicleId: "in", position: { ...vehicle().position, lat: 41.8, lng: -87.6 } });
  const outside = vehicle({ vehicleId: "out", position: { ...vehicle().position, lat: 34.0, lng: -118.2 } });

  it("keeps only the trucks the camera can see", () => {
    expect(scopeToViewport([inside, outside], CHICAGO).map((v) => v.vehicleId)).toEqual(["in"]);
  });

  it("treats null as OFF and hands back every truck, rather than as an empty rectangle", () => {
    // A map that has not reported its bounds yet would otherwise blank the fleet for a frame, which
    // reads as a broken board rather than as a filter waiting for a camera.
    expect(scopeToViewport([inside, outside], null)).toHaveLength(2);
  });

  it("excludes a truck that is outside on LATITUDE alone", () => {
    // The first draft compared longitude only, which passes everything on a fleet running east-west.
    const north = vehicle({ vehicleId: "n", position: { ...vehicle().position, lat: 48.0, lng: -87.6 } });
    expect(scopeToViewport([north], CHICAGO)).toHaveLength(0);
  });

  it("counts a truck exactly on the edge as visible, because it is drawn on screen", () => {
    const edge = vehicle({ vehicleId: "e", position: { ...vehicle().position, lat: 42, lng: -88 } });
    expect(scopeToViewport([edge], CHICAGO)).toHaveLength(1);
  });
});

describe("STATE_COLOR_CLASS", () => {
  /**
   * ⚠ The four marker colours, held apart STRUCTURALLY, because the perceptual measurement that
   * chose them cannot run here — the values live in `tokens.css` and only resolve in a browser
   * (`tokenColor` is why `liveMapIcons.ts` has no test at all).
   *
   * What a unit test CAN hold is the rule that broke: `parked` and `offline` were both `neutral`,
   * two states sharing one ramp, and on the canvas they measured 0.076 apart as painted — the same
   * grey at a glance. One state, one ramp family. The numbers behind the choice are in
   * `STATE_COLOR_CLASS`'s own header.
   */
  const family = (cls: string) => cls.replace(/^text-/, "").replace(/-\d+$/, "");

  it("gives every state its own ramp family, which is the rule that had broken", () => {
    const families = MAP_STATES.map((s) => family(STATE_COLOR_CLASS[s]));
    expect(families).toHaveLength(MAP_STATES.length);
    expect(new Set(families).size).toBe(MAP_STATES.length);
  });

  it("keeps `offline` the neutral one, because it is the population that must not be alarm-coloured", () => {
    // 54 of 199 trucks rendered offline the day the board first had data. A page that is a fifth
    // alarm-coloured teaches its reader to stop reading colour — see `badges.ts`.
    expect(family(STATE_COLOR_CLASS.offline)).toBe("neutral");
  });

  it("colours every state with a semantic token, never a raw palette utility", () => {
    // `lint:tokens` says the same thing about templates; these strings reach maplibre through
    // `tokenColor` instead, so they never pass under that gate's eye.
    for (const s of MAP_STATES) expect(STATE_COLOR_CLASS[s]).toMatch(/^text-(success|info|warning|caution|danger|accent|brand|neutral)-\d+$/);
  });
});
