import { describe, it, expect } from "vitest";
import type { LiveMapBoard, LiveMapVehicle } from "@silvicom/shared";
import {
  ICON_NAMES,
  MAP_STATES,
  filterVehicles,
  formatAge,
  iconNameFor,
  offlineBoundSentence,
  stateCounts,
  toFeatureCollection,
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

describe("formatAge", () => {
  it("reads in the unit the number deserves", () => {
    expect(formatAge(2)).toBe("2s ago");
    expect(formatAge(59)).toBe("59s ago");
    expect(formatAge(240)).toBe("4m ago");
    expect(formatAge(7200)).toBe("2h ago");
    // The seven `active` trucks whose telematics stopped more than a week ago — a fleet problem the
    // map is for surfacing, and unreadable as "1468800s ago".
    expect(formatAge(17 * 86_400)).toBe("17d ago");
  });
});

describe("offlineBoundSentence", () => {
  /**
   * ⚠ The legend must READ the bound rather than restate it. `bounds` is on the response precisely
   * so no component holds a second copy, and a hard-coded "15 minutes" is wrong the day it is
   * retuned — so this asserts against a bound that is NOT the production one.
   */
  it("says the bound the response sent, not the one in production today", () => {
    const bounds: LiveMapBoard["bounds"] = {
      stoppedSpeedMph: 3,
      engineOnBoundSeconds: 30,
      offlineBoundSeconds: 1_800,
    };
    expect(offlineBoundSentence(bounds)).toBe("No fix for over 30 min");
  });
});
