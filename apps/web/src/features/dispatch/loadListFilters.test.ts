import { describe, expect, it } from "vitest";
import { ref } from "vue";
import type { UrlQueryState } from "@silvicom/ui";
import { NO_DRIVER, deliveredCell, driverOptions, matchesUnits, truckOptions, useDeliveredWindow } from "./loadListFilters";
import type { DispatchLoad } from "./useDispatchLoads";

/** LOADS-ACTIVITY-PLAN D-LA6: the Delivered window in carrier days, and exact Driver / Truck filters. */
const load = (id: string, over: Partial<DispatchLoad> = {}): DispatchLoad =>
  ({
    id, ref: id, status: "delivered", source: "tms", driver_id: "d1", driver_name: "Kim Dixon", co_driver_id: null, co_driver_name: null,
    vehicle_id: "v801", vehicle_unit: "801", stops: [], ...over,
  }) as DispatchLoad;

/** A URL state over a plain record, enough for the window's params. */
function fakeQs(initial: Record<string, string> = {}) {
  const state = ref<Record<string, string | undefined>>({ ...initial });
  const qs = {
    param: (key: string) => ({
      get value() { return state.value[key] ?? ""; },
      set value(v: string) { state.value = { ...state.value, [key]: v || undefined }; },
    }),
    set: (patch: Record<string, string | undefined>) => (state.value = { ...state.value, ...patch }),
  } as unknown as UrlQueryState;
  return { qs, state };
}
const NOW = () => new Date("2026-10-19T03:30:00Z"); // 10/18 22:30 in Chicago: still the 18th there

describe("useDeliveredWindow", () => {
  it("defaults to the last thirty CARRIER days (D-DLC6), ending on the carrier's today, not the UTC one", () => {
    const { qs } = fakeQs();
    const w = useDeliveredWindow(qs, ref("America/Chicago"), NOW);
    expect([w.from.value, w.to.value]).toEqual(["2026-09-19", "2026-10-18"]);
    // Chicago midnights, CDT (UTC−5): 09/19's start and 10/19's start.
    expect(w.instants.value).toEqual({ from: "2026-09-19T05:00:00.000Z", before: "2026-10-19T05:00:00.000Z" });
    expect(w.moved.value).toBe(false);
  });

  it("reads a picked window from the URL, and writes nothing while a day equals its default", () => {
    const { qs, state } = fakeQs({ delivered_from: "2026-10-01", delivered_to: "2026-10-05" });
    const w = useDeliveredWindow(qs, ref("America/Chicago"), NOW);
    expect(w.instants.value.from).toBe("2026-10-01T05:00:00.000Z");
    expect(w.moved.value).toBe(true);
    w.to.value = "2026-10-18";
    expect(state.value.delivered_to).toBeUndefined();
    w.from.value = "2026-10-03";
    expect(state.value.delivered_from).toBe("2026-10-03");
  });

  it("falls back to the default for a hand-edited day that is not a day", () => {
    const { qs } = fakeQs({ delivered_from: "10/01/2026" });
    expect(useDeliveredWindow(qs, ref("America/Chicago"), NOW).from.value).toBe("2026-09-19");
  });
});

describe("matchesUnits", () => {
  it("matches a driver in EITHER seat of a team (D-LA2), and one truck exactly", () => {
    const team = load("T", { driver_id: "d1", co_driver_id: "d2" });
    expect(matchesUnits(team, "d2", "")).toBe(true);
    expect(matchesUnits(team, "d3", "")).toBe(false);
    expect(matchesUnits(load("A", { vehicle_id: "v806" }), "", "v801")).toBe(false);
    expect(matchesUnits(load("B"), "", "v801")).toBe(true);
  });

  it("'No driver' keeps only loads with nobody in either seat", () => {
    expect(matchesUnits(load("A", { driver_id: null }), NO_DRIVER, "")).toBe(true);
    expect(matchesUnits(load("B", { driver_id: null, co_driver_id: "d2" }), NO_DRIVER, "")).toBe(false);
  });
});

describe("driverOptions / truckOptions", () => {
  it("lists each driver once, counting both seats, with No driver last when there is one", () => {
    const opts = driverOptions([
      load("A"),
      load("B", { co_driver_id: "d2", co_driver_name: "Marcus Houston" }),
      load("C", { driver_id: null, driver_name: null }),
    ]);
    expect(opts).toEqual([
      { value: "", label: "Any driver" },
      { value: "d1", label: "Kim Dixon", count: "2" },
      { value: "d2", label: "Marcus Houston", count: "1" },
      { value: NO_DRIVER, label: "No driver", count: "1" },
    ]);
  });

  it("orders trucks by unit as a number, so 99 comes before 801", () => {
    const opts = truckOptions([load("A"), load("B", { vehicle_id: "v99", vehicle_unit: "99" }), load("C")]);
    expect(opts.map((o) => [o.label, o.count])).toEqual([["Any truck", undefined], ["99", "1"], ["801", "2"]]);
  });
});

describe("deliveredCell", () => {
  const stops = (at: string) => [{ seq: 1, kind: "pickup", appointment_start: null, appointment_end: null, required_photos: [], name: "a" }, { seq: 2, kind: "dropoff", actual_departure_at: at, appointment_start: null, appointment_end: null, required_photos: [], name: "b" }] as DispatchLoad["stops"];
  it("reads the last drop's departure on a delivered load, and flags one keyed ahead (D-LA4)", () => {
    const now = Date.parse("2026-10-19T18:00:00Z");
    expect(deliveredCell(load("A", { stops: stops("2026-10-18T10:00:00Z") }), now)).toEqual({ at: "2026-10-18T10:00:00Z", ahead: false });
    expect(deliveredCell(load("B", { stops: stops("2026-10-21T13:00:00Z") }), now)).toEqual({ at: "2026-10-21T13:00:00Z", ahead: true });
  });
  it("says nothing on a load that is not delivered", () => {
    expect(deliveredCell(load("C", { status: "in_transit", stops: stops("2026-10-18T10:00:00Z") }), 0).at).toBeNull();
  });
});
