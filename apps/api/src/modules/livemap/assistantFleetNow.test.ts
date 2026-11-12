import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveMapBoard, LiveMapVehicle, VehicleMapState } from "@silvicom/shared";

/** The tool's answer is `unknown` to its caller (it goes to the model as JSON); tests read named fields. */
type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Ask AI's `fleet_now` (F21 R6b). Its header promises the counts are the live map's own states, read
 * from the board the map reads, never re-judged. So the board is a spy, and its states deliberately
 * DISAGREE with the speeds (a parked truck reporting 40 mph, a moving one reporting 0): a tool that
 * re-derived a state from speed would count differently from the map.
 */
const readLiveMapBoardCached = vi.fn();
vi.mock("./liveMapBoardCache.js", () => ({ readLiveMapBoardCached: (...a: unknown[]) => readLiveMapBoardCached(...a) }));
const { assistantFleetNow } = await import("./assistantFleetNow.js");

const ORG = "org-1";
const v = (unit: string, state: VehicleMapState, speed: number | null, driver: string | null, extra: Partial<LiveMapVehicle> = {}): LiveMapVehicle =>
  ({
    vehicleId: `v${unit}`,
    unitNumber: unit,
    driver: driver ? { id: `d${unit}`, name: driver } : null,
    position: { lat: 41.8, lng: -87.6, headingDegrees: null, speedMph: speed, isEcuSpeed: true, formattedLocation: `Near ${unit}`, sampledAt: "2026-11-10T18:59:50Z", receivedAt: null },
    state,
    engineState: null,
    inShop: false,
    ageSeconds: 10,
    fuel: null,
    load: null,
    ...extra,
  }) as LiveMapVehicle;

const BOARD = {
  generatedAt: "2026-11-10T19:00:00Z",
  scope: "all",
  scopeReason: "Every truck in the fleet.",
  bounds: { stoppedSpeedMph: 3, engineOnBoundSeconds: 900, offlineBoundSeconds: 3600, fuelFreshSeconds: 3600 },
  vehicles: [
    v("748", "moving", 0, "ANA"),
    v("751", "moving", 61, "BEN", { load: { id: "l1", ref: "L-100", status: "in_transit", nextStop: { seq: 2, kind: "drop", name: null, city: "Joliet", state: "IL", appointmentStart: null, appointmentEnd: null, status: null } } }),
    v("762", "moving", 55, null),
    v("763", "parked", 40, "CAL"),
    v("784", "stopped", 1, "DEE", { inShop: true }),
    v("785", "offline", null, null),
  ],
  untracked: [{ vehicleId: "v900", unitNumber: "900" }],
  truncated: false,
} as unknown as LiveMapBoard;

beforeEach(() => {
  readLiveMapBoardCached.mockReset();
  readLiveMapBoardCached.mockResolvedValue(BOARD);
});

describe("fleet_now — the live map's board, counted by its own states", () => {
  it("reads the page's cached board for this org, and counts by the board's states, never by speed", async () => {
    const admin = {} as never;
    const out = (await assistantFleetNow(admin, ORG, {})) as Out;
    expect(readLiveMapBoardCached).toHaveBeenCalledWith(admin, ORG);
    expect(out.by_state).toEqual({ moving: 3, stopped: 1, parked: 1, offline: 1 });
    expect(out.with_a_driver_by_state).toEqual({ moving: 2, stopped: 1, parked: 1, offline: 0 });
    expect(out).toMatchObject({ as_of: "2026-11-10T19:00:00Z", trucks_on_map: 6, in_shop: 1, trucks_never_positioned: 1 });
    expect(out.trucks).toBeUndefined();
  });

  it("lists the trucks in the state asked, with the map's own facts", async () => {
    const out = (await assistantFleetNow({} as never, ORG, { state: "moving", limit: 2 })) as Out;
    expect(out.trucks).toEqual([
      { unit: "748", driver: "ANA", state: "moving", speed_mph: 0, location: "Near 748", position_age_seconds: 10, in_shop: false, load: null, next_stop: null },
      { unit: "751", driver: "BEN", state: "moving", speed_mph: 61, location: "Near 751", position_age_seconds: 10, in_shop: false, load: "L-100", next_stop: "Joliet, IL" },
    ]);
    expect(out.trucks_note).toBe("2 of 3 moving trucks listed.");
  });

  it("ignores a state the map does not have rather than guessing one", async () => {
    const out = (await assistantFleetNow({} as never, ORG, { state: "driving" })) as Out;
    expect(out.trucks).toBeUndefined();
  });
});
