import { describe, it, expect } from "vitest";
import {
  boardEta,
  onTimeVerdict,
  availableAt,
  availableNear,
  boardEtaAlong,
  boardMiles,
  knownCityPoints,
  usPlaceParts,
  freshHos,
  boardFlags,
  inMyScope,
  movedByOther,
  BOARD_RESET_MS,
} from "./dispatchBoard.js";
import type { DispatchBoardHos, DispatchBoardLoad, DispatchBoardStop } from "./dispatchBoardContract.js";

const NOW = new Date("2026-10-09T20:00:00Z");
const H = 3_600_000;
// Joliet, IL → Indianapolis, IN: ~150 straight-line miles.
const JOLIET = { lat: 41.525, lng: -88.0817 };
const stop = (over: Partial<DispatchBoardStop> = {}): DispatchBoardStop => ({
  seq: 2, kind: "dropoff", name: "Kroger DC", city: "Indianapolis", state: "IN", postalCode: "46241",
  appointmentStart: "2026-10-10T02:00:00Z", appointmentEnd: "2026-10-10T04:00:00Z",
  arrivedAt: null, lat: 39.7684, lng: -86.1581, ...over,
});
const hos = (over: Partial<DispatchBoardHos> = {}): DispatchBoardHos => ({
  status: "driving", driveRemainingMs: 6 * H, shiftRemainingMs: 8 * H, cycleRemainingMs: 40 * H,
  breakRemainingMs: 3 * H, fetchedAt: "2026-10-09T19:58:00Z", ...over,
});
const load = (over: Partial<DispatchBoardLoad> = {}): DispatchBoardLoad => ({
  loadId: "l-1", ref: "291013", status: "in_transit", source: "tms", externalStatus: "P",
  customerName: "Viking Packing", dispatcherId: "vinniev", driverName: "J. Smith", trailerUnit: "3152",
  nextStop: stop(), lastStop: stop(), stopsLeft: 1, ...over,
});

describe("boardEta — the v1 distance ETA (D-DB4)", () => {
  it("drives road miles at the planning speed from the truck to the stop", () => {
    const eta = boardEta(JOLIET, stop(), hos(), NOW)!;
    // ~150 straight-line × 1.2 road factor ≈ 180 road miles ≈ 3.6 h at 50 mph.
    expect(eta.miles).toBeGreaterThan(170);
    expect(eta.miles).toBeLessThan(190);
    expect(Date.parse(eta.at) - NOW.getTime()).toBeGreaterThan(3.4 * H);
    expect(Date.parse(eta.at) - NOW.getTime()).toBeLessThan(3.8 * H);
    expect(eta.restAdded).toBe(false);
  });

  it("adds the ten-hour reset when the binding clock — here the SHIFT — runs out first", () => {
    const eta = boardEta(JOLIET, stop(), hos({ driveRemainingMs: 9 * H, shiftRemainingMs: 1 * H }), NOW)!;
    expect(eta.restAdded).toBe(true);
    expect(Date.parse(eta.at) - NOW.getTime()).toBeGreaterThan(BOARD_RESET_MS + 3.4 * H);
  });

  it("gives no ETA from nowhere or to nowhere", () => {
    expect(boardEta(null, stop(), hos(), NOW)).toBeNull();
    expect(boardEta(JOLIET, stop({ lat: null }), hos(), NOW)).toBeNull();
    expect(boardEta(JOLIET, null, hos(), NOW)).toBeNull();
  });
});

describe("onTimeVerdict — against the window's close", () => {
  const eta = (iso: string) => ({ at: iso, miles: 100, restAdded: false });
  it("is on time well inside the window, at risk inside the last hour, late past it", () => {
    expect(onTimeVerdict(stop(), eta("2026-10-10T01:00:00Z"))).toBe("on_time");
    expect(onTimeVerdict(stop(), eta("2026-10-10T03:30:00Z"))).toBe("at_risk");
    expect(onTimeVerdict(stop(), eta("2026-10-10T04:01:00Z"))).toBe("late");
  });
  it("closes on the start when McLeod gave no end", () => {
    expect(onTimeVerdict(stop({ appointmentEnd: null }), eta("2026-10-10T02:30:00Z"))).toBe("late");
  });
  it("judges a reached stop by its actual arrival, never by an estimate", () => {
    expect(onTimeVerdict(stop({ arrivedAt: "2026-10-10T03:55:00Z" }), null)).toBe("on_time");
    expect(onTimeVerdict(stop({ arrivedAt: "2026-10-10T04:30:00Z" }), eta("2026-10-10T01:00:00Z"))).toBe("late");
  });
  it("is unknown — never green — with no appointment or no ETA", () => {
    expect(onTimeVerdict(stop({ appointmentStart: null, appointmentEnd: null }), eta("2026-10-10T01:00:00Z"))).toBe("unknown");
    expect(onTimeVerdict(stop(), null)).toBe("unknown");
    expect(onTimeVerdict(null, null)).toBe("unknown");
  });
});

describe("availableAt — the PTA pair, structured (D-DBV3)", () => {
  it("is the last delivery at the later of its appointment and the arrival, and says which set it", () => {
    const late = { at: "2026-10-10T05:00:00Z", miles: 180, restAdded: false };
    expect(availableAt(load(), late, null, NOW)).toEqual({
      place: "Indianapolis, IN", city: "Indianapolis", state: "IN", postalCode: "46241",
      lat: 39.7684, lng: -86.1581, at: "2026-10-10T05:00:00.000Z", basis: "eta",
    });
    const early = { at: "2026-10-09T23:00:00Z", miles: 180, restAdded: false };
    expect(availableAt(load(), early, null, NOW)).toMatchObject({ at: "2026-10-10T02:00:00.000Z", basis: "appointment" });
  });
  it("has no time, and no basis, with neither an appointment nor an ETA", () => {
    const last = stop({ appointmentStart: null, appointmentEnd: null });
    expect(availableAt(load({ lastStop: last }), null, null, NOW)).toMatchObject({ at: null, basis: null, state: "IN" });
  });
  it("is here and now for a truck with no load, its state read from Samsara's place", () => {
    const here = { place: "1101 West Ruth Avenue, Sallisaw, OK, 74955", lat: 35.46, lng: -94.79 };
    expect(availableAt(null, null, here, NOW)).toEqual({
      place: here.place, city: "Sallisaw", state: "OK", postalCode: "74955", lat: 35.46, lng: -94.79,
      at: NOW.toISOString(), basis: "now",
    });
  });
});

describe("usPlaceParts — Samsara's reverse-geocoded place", () => {
  it("reads city, state and ZIP from the end, with or without a street or a ZIP", () => {
    expect(usPlaceParts("I 75, Cecil, GA, 31627")).toEqual({ city: "Cecil", state: "GA", postalCode: "31627" });
    expect(usPlaceParts("Waco, TX, 76711")).toEqual({ city: "Waco", state: "TX", postalCode: "76711" });
    expect(usPlaceParts("Joliet, IL")).toEqual({ city: "Joliet", state: "IL", postalCode: null });
  });
  it("guesses nothing from a place that does not end in a state code", () => {
    expect(usPlaceParts("Near the yard")).toEqual({ city: null, state: null, postalCode: null });
    expect(usPlaceParts("Ontario, Canada")).toEqual({ city: null, state: null, postalCode: null });
    expect(usPlaceParts(null)).toEqual({ city: null, state: null, postalCode: null });
  });
});

describe("boardMiles — miles left, the legs chained (D-DBV4)", () => {
  // Joliet → Lafayette, IN → Indianapolis is longer than Joliet → Indianapolis straight.
  const LAFAYETTE = { lat: 40.4167, lng: -86.8753 };
  it("drives through a stop on the way rather than cutting across it", () => {
    const direct = boardMiles(JOLIET, [stop()])!;
    const via = boardMiles(JOLIET, [LAFAYETTE, stop()])!;
    expect(via).toBeGreaterThan(direct);
    expect(boardEtaAlong(JOLIET, [LAFAYETTE, stop()], hos(), NOW)!.miles).toBe(Math.round(via));
  });
  it("is unknown, not short, when any stop on the path has no coordinates", () => {
    expect(boardMiles(JOLIET, [{ lat: null, lng: null }, stop()])).toBeNull();
    expect(boardMiles(null, [stop()])).toBeNull();
    expect(boardMiles(JOLIET, [])).toBeNull();
  });
});

describe("availableNear — the dispatchers' state box, made precise (D-DBV3)", () => {
  const orlando = { lat: 28.5384, lng: -81.3789 };
  const fl = availableAt(null, null, { place: "Lakeland, FL, 33801", lat: 28.0395, lng: -81.9498 }, NOW);
  it("matches by state, case-insensitively, and everything when nothing is asked", () => {
    expect(availableNear(fl, { states: ["fl"] })).toBe(true);
    expect(availableNear(fl, { states: ["GA"] })).toBe(false);
    expect(availableNear(fl, {})).toBe(true);
  });
  it("matches within a straight-line radius of a city", () => {
    // Lakeland is ~50 straight-line miles from Orlando.
    expect(availableNear(fl, { near: { ...orlando, radiusMiles: 60 } })).toBe(true);
    expect(availableNear(fl, { near: { ...orlando, radiusMiles: 40 } })).toBe(false);
  });
  it("matches by time only when the truck is free at or before it, and never with no time", () => {
    expect(availableNear(fl, { by: NOW.toISOString() })).toBe(true);
    expect(availableNear(fl, { by: new Date(NOW.getTime() - 1).toISOString() })).toBe(false);
    expect(availableNear({ ...fl!, at: null }, { by: NOW.toISOString() })).toBe(false);
  });
  it("finds no truck that has nowhere to be free, once anything is asked", () => {
    expect(availableNear(null, { states: ["FL"] })).toBe(false);
  });
});

describe("knownCityPoints — a typed city, found on the board's own rows", () => {
  it("keys each city once by name and state, and skips a row without coordinates", () => {
    const a = availableAt(load(), null, null, NOW);
    const pts = knownCityPoints([{ available: a }, { available: { ...a!, lat: null } }, { available: null }]);
    expect([...pts.keys()]).toEqual(["INDIANAPOLIS|IN"]);
  });
});

describe("freshHos", () => {
  it("drops clocks older than three polls rather than show them as now", () => {
    expect(freshHos(hos(), NOW)).not.toBeNull();
    expect(freshHos(hos({ fetchedAt: "2026-10-09T19:40:00Z" }), NOW)).toBeNull();
  });
});

describe("boardFlags — one flag per problem", () => {
  const base = { inShop: false, current: load(), next: load({ loadId: "l-2" }), onTime: "on_time" as const, hos: hos(), gpsAgeSeconds: 30 };
  it("raises nothing for a healthy truck with its next load planned", () => {
    expect(boardFlags(base)).toEqual({ lateRisk: false, noNextLoad: false, emptyNow: false, hosLow: false, noGps: false });
  });
  it("flags no next load, empty, low HOS and stale GPS separately", () => {
    expect(boardFlags({ ...base, next: null }).noNextLoad).toBe(true);
    expect(boardFlags({ ...base, current: null, next: null })).toMatchObject({ emptyNow: true, noNextLoad: false });
    expect(boardFlags({ ...base, hos: hos({ driveRemainingMs: H }) }).hosLow).toBe(true);
    expect(boardFlags({ ...base, gpsAgeSeconds: 3600 }).noGps).toBe(true);
    expect(boardFlags({ ...base, gpsAgeSeconds: null }).noGps).toBe(true);
    expect(boardFlags({ ...base, onTime: "at_risk" }).lateRisk).toBe(true);
  });
  it("does not call a truck in the shop empty, and an empty truck's low clock is not a risk", () => {
    expect(boardFlags({ ...base, inShop: true, current: null, next: null })).toMatchObject({ emptyNow: false, noNextLoad: false });
    expect(boardFlags({ ...base, current: null, next: null, hos: hos({ driveRemainingMs: H }) }).hosLow).toBe(false);
  });
});

describe("inMyScope — two axes, never merged (D-DB1)", () => {
  const scope = { linked: true, fleetCodes: ["VINNIEV"], dispatcherIds: ["vinniev"] };
  it("includes my fleet's truck even while a colleague moves it", () => {
    expect(inMyScope({ fleetCode: "VINNIEV", current: { dispatcherId: "asen" }, next: null }, scope)).toBe(true);
  });
  it("includes another fleet's truck on a load I dispatch, current or next", () => {
    expect(inMyScope({ fleetCode: "VLADI", current: { dispatcherId: "vinniev" }, next: null }, scope)).toBe(true);
    expect(inMyScope({ fleetCode: "VLADI", current: null, next: { dispatcherId: "vinniev" } }, scope)).toBe(true);
  });
  it("excludes everything else, and a truck with no fleet and no load", () => {
    expect(inMyScope({ fleetCode: "VLADI", current: { dispatcherId: "asen" }, next: null }, scope)).toBe(false);
    expect(inMyScope({ fleetCode: null, current: null, next: null }, scope)).toBe(false);
  });
});

describe("movedByOther", () => {
  it("marks a load moved by someone other than the fleet's dispatcher, and nothing unknown", () => {
    expect(movedByOther("vladi", { dispatcherId: "asen" })).toBe(true);
    expect(movedByOther("vladi", { dispatcherId: "vladi" })).toBe(false);
    expect(movedByOther(null, { dispatcherId: "asen" })).toBe(false);
    expect(movedByOther("vladi", { dispatcherId: null })).toBe(false);
  });
});
