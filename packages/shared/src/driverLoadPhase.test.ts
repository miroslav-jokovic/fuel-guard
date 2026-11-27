import { describe, expect, it } from "vitest";
import { driverLoadPhase, loadBucket, nextStop, stopProgress, type Load, type LoadStop } from "./index.js";

/**
 * The driver's phase of a load, its next stop and its counter (T1 N-9, spec A §3.3). `loadBucket`,
 * `nextStop` and `stopProgress` moved here from loadsContract.test.ts with their functions (audit A-18).
 */
function stop(over: Partial<LoadStop> = {}): LoadStop {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    seq: 1,
    kind: "pickup",
    name: "Shipper",
    address_line: null,
    city: null,
    state: null,
    postal_code: null,
    lat: null,
    lon: null,
    appointment_start: null,
    appointment_end: null,
    status: "pending",
    arrived_at: null,
    completed_at: null,
    required_photos: [],
    skip_reason: null,
    notes: null,
    photos: [],
    external_status: null,
    actual_arrival_at: null,
    actual_departure_at: null,
    mcleod_removed_at: null,
    ...over,
  };
}

type PhaseLoad = Pick<Load, "source" | "status" | "stops" | "acknowledged_at">;
const tms = (over: Partial<PhaseLoad> = {}): PhaseLoad => ({
  source: "tms",
  status: "approved",
  acknowledged_at: null,
  stops: [stop({ id: "p", seq: 1, kind: "pickup" }), stop({ id: "d", seq: 2, kind: "dropoff" })],
  ...over,
});

describe("driverLoadPhase", () => {
  it("a sent McLeod load nobody touched awaits Got it", () => {
    expect(driverLoadPhase(tms())).toBe("awaiting_ack");
    expect(driverLoadPhase(tms({ status: "pending_approval" }))).toBe("awaiting_ack");
  });

  it("after Got it it is upcoming", () => {
    expect(driverLoadPhase(tms({ acknowledged_at: "2026-11-27T15:14:00Z" }))).toBe("upcoming");
  });

  it("the driver's first Arrive makes it current with loads.status still approved", () => {
    const load = tms({ stops: [stop({ id: "p", seq: 1, status: "arrived" }), stop({ id: "d", seq: 2 })] });
    expect(load.status).toBe("approved");
    expect(driverLoadPhase(load)).toBe("current");
  });

  it("McLeod's in_transit makes it current before the driver taps anything", () => {
    expect(driverLoadPhase(tms({ status: "in_transit" }))).toBe("current");
  });

  it("a stop McLeod departed is behind the driver even if they never tapped it", () => {
    const load = tms({ status: "in_transit", stops: [stop({ id: "p", seq: 1, external_status: "D" }), stop({ id: "d", seq: 2 })] });
    expect(nextStop(load)?.id).toBe("d");
    expect(stopProgress(load)).toEqual({ current: 2, total: 2 });
  });

  it("a stop removed in McLeod is behind the driver", () => {
    const load = tms({ stops: [stop({ id: "p", seq: 1, mcleod_removed_at: "2026-11-26T10:00:00Z" }), stop({ id: "d", seq: 2 })] });
    expect(nextStop(load)?.id).toBe("d");
  });

  it("every stop behind → previous even while McLeod says in_transit", () => {
    const load = tms({
      status: "in_transit",
      stops: [stop({ id: "p", seq: 1, status: "completed" }), stop({ id: "d", seq: 2, external_status: "D" })],
    });
    expect(driverLoadPhase(load)).toBe("previous");
  });

  it("delivered/canceled → previous", () => {
    expect(driverLoadPhase(tms({ status: "delivered" }))).toBe("previous");
    expect(driverLoadPhase(tms({ status: "canceled", acknowledged_at: null }))).toBe("previous");
  });

  it("a manual offered load is still an offer", () => {
    const manual: PhaseLoad = { source: "manual", status: "offered", acknowledged_at: null, stops: [stop()] };
    expect(driverLoadPhase(manual)).toBe("upcoming");
    expect(driverLoadPhase({ ...manual, status: "in_transit" })).toBe("current");
    // A manual load never waits on "Got it", whatever its acknowledgement reads.
    expect(driverLoadPhase({ ...manual, stops: [stop({ status: "arrived" })] })).toBe("upcoming");
  });
});

describe("loadBucket", () => {
  it("groups statuses into the app's three tabs", () => {
    expect(loadBucket("offered")).toBe("upcoming");
    expect(loadBucket("accepted")).toBe("upcoming");
    expect(loadBucket("in_transit")).toBe("current");
    expect(loadBucket("delivered")).toBe("previous");
    expect(loadBucket("canceled")).toBe("previous");
  });
});

describe("nextStop", () => {
  it("returns the lowest-seq unfinished stop", () => {
    const load = {
      stops: [
        stop({ id: "a", seq: 1, status: "completed" }),
        stop({ id: "b", seq: 2, status: "pending" }),
        stop({ id: "c", seq: 3, status: "pending" }),
      ],
    };
    expect(nextStop(load)?.id).toBe("b");
  });

  it("treats a skipped stop as finished", () => {
    const load = {
      stops: [stop({ id: "a", seq: 1, status: "skipped" }), stop({ id: "b", seq: 2, status: "arrived" })],
    };
    expect(nextStop(load)?.id).toBe("b");
  });

  it("returns null once every stop is done", () => {
    expect(nextStop({ stops: [stop({ status: "completed" })] })).toBeNull();
  });

  it("is order-independent (data may arrive unsorted)", () => {
    const load = {
      stops: [stop({ id: "c", seq: 3 }), stop({ id: "a", seq: 1 }), stop({ id: "b", seq: 2 })],
    };
    expect(nextStop(load)?.id).toBe("a");
  });
});

describe("stopProgress", () => {
  it("counts the stop being worked on, not the one finished", () => {
    expect(stopProgress({ stops: [stop({ status: "completed" }), stop(), stop()] })).toEqual({
      current: 2,
      total: 3,
    });
  });

  it("clamps to the total when everything is done", () => {
    expect(
      stopProgress({ stops: [stop({ status: "completed" }), stop({ status: "completed" })] }),
    ).toEqual({ current: 2, total: 2 });
  });

  it("does not divide by zero on a stopless load", () => {
    expect(stopProgress({ stops: [] })).toEqual({ current: 1, total: 0 });
  });
});

