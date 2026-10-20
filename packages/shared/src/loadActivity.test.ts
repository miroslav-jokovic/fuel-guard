import { describe, expect, it } from "vitest";
import { isEnteredAhead, loadDeliveredAt, loadPickedUpAt, summarizeActivity, type ActivityLoad } from "./index.js";

/**
 * LOADS-ACTIVITY-PLAN D-LA1, D-LA4, D-LA5, D-LA7. Shapes are the production ones of 2026-10-19: McLeod
 * departure on every stop of a delivered load, a team movement with two seats, a time keyed ahead, an
 * empty move.
 */
const NOW = Date.parse("2026-10-19T18:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const load = (over: Partial<ActivityLoad> = {}): ActivityLoad => ({
  id: "L1", ref: "0136001", status: "delivered", source: "tms", loaded: true,
  driver_id: "D1", co_driver_id: null, vehicle_id: "V1", dispatcher_external_id: "romann",
  stops: [
    { seq: 1, kind: "pickup", actual_departure_at: day(5) },
    { seq: 2, kind: "dropoff", actual_departure_at: day(3) },
  ],
  ...over,
});
const drivers = (loads: ActivityLoad[], ids = ["D1", "D2"]) =>
  summarizeActivity(loads, ids, (l) => [l.driver_id, l.co_driver_id], NOW);

describe("loadDeliveredAt / loadPickedUpAt (D-LA1)", () => {
  it("reads McLeod's departure from the LAST delivery and the FIRST pickup, by seq not array order", () => {
    const stops = [
      { seq: 3, kind: "dropoff" as const, actual_departure_at: "2026-10-12T10:00:00Z" },
      { seq: 1, kind: "pickup" as const, actual_departure_at: "2026-10-10T08:00:00Z" },
      { seq: 2, kind: "dropoff" as const, actual_departure_at: "2026-10-11T09:00:00Z" },
    ];
    expect(loadDeliveredAt(stops)).toBe("2026-10-12T10:00:00Z");
    expect(loadPickedUpAt(stops)).toBe("2026-10-10T08:00:00Z");
  });

  it("falls back to the driver app's completion only when McLeod has no departure", () => {
    expect(loadDeliveredAt([{ seq: 1, kind: "dropoff", actual_departure_at: null, completed_at: "2026-10-12T10:00:00Z" }])).toBe("2026-10-12T10:00:00Z");
    expect(loadDeliveredAt([{ seq: 1, kind: "dropoff", actual_departure_at: "2026-10-12T11:00:00Z", completed_at: "2026-10-12T10:00:00Z" }])).toBe("2026-10-12T11:00:00Z");
  });

  it("is null until the truck has left, and null on a load with no delivery stop", () => {
    expect(loadDeliveredAt([{ seq: 1, kind: "dropoff" }])).toBeNull();
    expect(loadDeliveredAt([{ seq: 1, kind: "pickup", actual_departure_at: day(1) }])).toBeNull();
  });
});

describe("isEnteredAhead (D-LA4)", () => {
  it("flags a recorded time later than now, and nothing at or before it", () => {
    expect(isEnteredAhead(new Date(NOW + 60_000).toISOString(), NOW)).toBe(true);
    expect(isEnteredAhead(new Date(NOW).toISOString(), NOW)).toBe(false);
    expect(isEnteredAhead(null, NOW)).toBe(false);
  });
});

describe("summarizeActivity (D-LA7)", () => {
  it("counts whole days since the last delivery for a driver with no load on the truck", () => {
    const a = drivers([load()]).get("D1")!;
    expect(a).toMatchObject({ currentLoad: null, lastPickupAt: day(5), lastDeliveryAt: day(3), daysWithoutLoad: 3, vehicleId: "V1", dispatcherId: "romann" });
  });

  it("reads 0 days while a load is on the truck, however long ago the last stop was", () => {
    const a = drivers([load(), load({ id: "L2", ref: "0136002", status: "in_transit", stops: [{ seq: 1, kind: "pickup", actual_departure_at: day(4) }, { seq: 2, kind: "dropoff" }] })]).get("D1")!;
    expect(a.currentLoad).toEqual({ id: "L2", ref: "0136002", empty: false });
    expect(a.daysWithoutLoad).toBe(0);
  });

  it("credits BOTH seats of a team load, so the second driver is not read as idle (D-LA2)", () => {
    const m = drivers([load({ co_driver_id: "D2" })]);
    expect(m.get("D2")).toMatchObject({ lastDeliveryAt: day(3), daysWithoutLoad: 3 });
    expect(m.get("D1")!.daysWithoutLoad).toBe(3);
  });

  it("names a planned next load without calling the driver busy: days still count from the delivery", () => {
    const a = drivers([load(), load({ id: "L3", ref: "0136003", status: "pending_approval", stops: [{ seq: 1, kind: "pickup" }] })]).get("D1")!;
    expect(a.plannedLoad).toEqual({ id: "L3", ref: "0136003" });
    expect(a).toMatchObject({ currentLoad: null, daysWithoutLoad: 3 });
  });

  it("does not list McLeod's dispatched-but-not-started load (approved) as planned: it is the load on the truck", () => {
    const a = drivers([load({ id: "L4", ref: "0136004", status: "approved", stops: [{ seq: 1, kind: "pickup" }] })]).get("D1")!;
    expect(a).toMatchObject({ currentLoad: { id: "L4" }, plannedLoad: null, daysWithoutLoad: 0 });
  });

  it("never counts an empty move as a pickup or a delivery, but an empty move under way is the current load (D-LA5)", () => {
    expect(drivers([load({ loaded: false })]).get("D1")).toMatchObject({ lastPickupAt: null, lastDeliveryAt: null, daysWithoutLoad: null });
    const moving = drivers([load({ loaded: false, status: "in_transit" })]).get("D1")!;
    expect(moving).toMatchObject({ currentLoad: { ref: "0136001", empty: true }, daysWithoutLoad: 0 });
  });

  it("counts a canceled load for nobody", () => {
    expect(drivers([load({ status: "canceled" })]).get("D1")).toMatchObject({ lastDeliveryAt: null, daysWithoutLoad: null, vehicleId: null });
  });

  it("reads a delivery keyed ahead as 0 days and says it was entered ahead (D-LA4)", () => {
    const ahead = new Date(NOW + 2 * 86_400_000).toISOString();
    const a = drivers([load({ stops: [{ seq: 1, kind: "pickup", actual_departure_at: day(1) }, { seq: 2, kind: "dropoff", actual_departure_at: ahead }] })]).get("D1")!;
    expect(a).toMatchObject({ lastDeliveryAt: ahead, enteredAhead: true, daysWithoutLoad: 0 });
  });

  it("leaves days null for a subject with no delivery in the window, never a made-up number", () => {
    expect(drivers([]).get("D2")).toMatchObject({ daysWithoutLoad: null, lastDeliveryAt: null, currentLoad: null });
  });

  it("does not count a load that is not delivered as a delivery, even if McLeod has its last stop departed", () => {
    const a = drivers([load({ status: "in_transit" })]).get("D1")!;
    expect(a.lastDeliveryAt).toBeNull();
    expect(a.lastPickupAt).toBe(day(5));
  });

  it("works for trucks with the vehicle as the subject", () => {
    const m = summarizeActivity([load()], ["V1", "V9"], (l) => [l.vehicle_id], NOW);
    expect(m.get("V1")!.daysWithoutLoad).toBe(3);
    expect(m.get("V9")!.daysWithoutLoad).toBeNull();
  });

  it("places the subject by its LATEST load's truck and dispatcher", () => {
    const older = load({ id: "L0", ref: "0135000", vehicle_id: "V0", dispatcher_external_id: "old", stops: [{ seq: 1, kind: "pickup", actual_departure_at: day(12) }, { seq: 2, kind: "dropoff", actual_departure_at: day(10) }] });
    expect(drivers([load(), older]).get("D1")).toMatchObject({ vehicleId: "V1", dispatcherId: "romann" });
    expect(drivers([older, load()]).get("D1")).toMatchObject({ vehicleId: "V1", dispatcherId: "romann" });
  });
});
