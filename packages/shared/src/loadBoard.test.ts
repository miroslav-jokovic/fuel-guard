import { describe, expect, it } from "vitest";
import { boardStops, loadBoardState, loadTypeOf } from "./index.js";

/**
 * The words the Loads board puts on a McLeod load (LR7). The two that matter are the live-board
 * findings of 2026-09-24: `P` under way reads "In transit", and an `A` that already has a driver and a
 * truck is "Planned", not "Uncovered".
 */
const tms = (status: string, extra: Record<string, unknown> = {}) =>
  loadBoardState({ status: status as never, source: "tms", ...extra });

describe("loadBoardState", () => {
  it("reads McLeod's P under way as In transit, on the Active queue", () => {
    expect(tms("in_transit", { external_status: "P" })).toEqual({
      queue: "active",
      label: "In transit",
      tone: "brand",
      mcleodWords: "McLeod status P (planned)",
    });
  });

  it("calls an A with a driver AND a truck Planned, and keeps it with the working loads", () => {
    const s = tms("pending_approval", { external_status: "A", driver_id: "d", vehicle_id: "v" });
    expect(s).toMatchObject({ queue: "active", label: "Planned" });
  });

  it.each([
    ["no driver", { vehicle_id: "v" }],
    ["no truck", { driver_id: "d" }],
    ["neither", {}],
  ])("calls an A with %s Uncovered, on its own queue", (_why, extra) => {
    expect(tms("pending_approval", { external_status: "A", ...extra })).toMatchObject({ queue: "uncovered", label: "Uncovered" });
  });

  it("reads a P with nothing done (approved) as Planned", () => {
    expect(tms("approved", { external_status: "P" })).toMatchObject({ queue: "active", label: "Planned" });
  });

  it("puts a delivered load on Delivered and a voided one in All only", () => {
    expect(tms("delivered", { external_status: "D" })).toMatchObject({ queue: "delivered", label: "Delivered" });
    expect(tms("canceled", { external_status: "V" })).toMatchObject({ queue: null, label: "Canceled", mcleodWords: "McLeod status V (void)" });
  });

  it("never offers an approval word", () => {
    const words = ["draft", "pending_approval", "approved", "offered", "accepted", "in_transit", "delivered", "canceled"].map(
      (s) => tms(s).label,
    );
    expect(words.join(" ")).not.toMatch(/approv|available/i);
  });

  it("shows an unknown McLeod code as it is, and none for a load McLeod never sent", () => {
    expect(tms("in_transit", { external_status: "X" }).mcleodWords).toBe("McLeod status X");
    expect(loadBoardState({ status: "in_transit", source: "manual", external_status: "P" }).mcleodWords).toBeNull();
  });
});

describe("boardStops", () => {
  it("takes the first pickup and the last delivery by McLeod's sequence, not by array order", () => {
    // Array order disagrees with McLeod's on purpose: read unsorted, the first pickup here is "b" and
    // the last delivery "c" — the wrong two.
    const stops = [
      { seq: 2, kind: "pickup" as const, id: "b" },
      { seq: 4, kind: "dropoff" as const, id: "d" },
      { seq: 1, kind: "pickup" as const, id: "a" },
      { seq: 3, kind: "dropoff" as const, id: "c" },
    ];
    const r = boardStops(stops);
    expect(r.pickup?.id).toBe("a");
    expect(r.delivery?.id).toBe("d");
    expect(r.extra).toBe(2);
  });

  it("counts nothing extra on a plain two-stop load, and copes with none", () => {
    expect(boardStops([{ seq: 1, kind: "pickup" }, { seq: 2, kind: "dropoff" }]).extra).toBe(0);
    expect(boardStops([])).toEqual({ pickup: null, delivery: null, extra: 0 });
  });
});

describe("loadTypeOf", () => {
  it("reads McLeod's Reefer, calls everything else Regular, and never lets hazmat hide the reefer", () => {
    expect(loadTypeOf({ equipment: "Reefer", hazmat: true })).toEqual({ base: "Reefer", hazmat: true });
    expect(loadTypeOf({ equipment: "Van" })).toEqual({ base: "Regular", hazmat: false });
    expect(loadTypeOf({ equipment: null, hazmat: true })).toEqual({ base: "Regular", hazmat: true });
  });
});
