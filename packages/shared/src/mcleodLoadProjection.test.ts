import { describe, expect, it } from "vitest";
import {
  projectMcleodMovement,
  projectMcleodStatus,
  projectWeightLbs,
  type RawDispatchMovement,
  type RawDispatchStop,
} from "./mcleodLoadProjection.js";

const movement = (over: Partial<RawDispatchMovement> = {}): RawDispatchMovement => ({
  company_id: "TMS", movement_id: "900", order_id: "0135527", movement_status: "P", loaded: "L",
  dispatcher_user_id: "romann", driver_codes: ["DKELLY"], tractor_id: "702", trailer_id: "536686",
  trailer_type: "R", commodity: "paints", customer_id: "BATTSOL", weight: "42000.0", weight_um: "LB",
  pieces: 24, consignee_refno: "PO-77", move_distance: "812.0", closed_at: null, ...over,
});
const stop = (over: Partial<RawDispatchStop> = {}): RawDispatchStop => ({
  stop_id: "s1", movement_sequence: 1, stop_type: "PU", status: "A", location_id: "BATTSOL1",
  location_name: "BATTERY SOLUTIONS", address: "1 Dock Rd", city_name: "Howell", state: "MI", zip_code: "48843",
  latitude: "42.600000", longitude: "-83.930000", sched_arrive_early: "2026-09-30T22:00:00+00:00",
  sched_arrive_late: null, actual_arrival: null, actual_departure: null, eta: null, contact_name: null,
  phone: null, ponum: null, ...over,
});
const ok = (m: RawDispatchMovement, s: RawDispatchStop[]) => {
  const r = projectMcleodMovement(m, s);
  if (!r.ok) throw new Error(r.reason);
  return r.load;
};

describe("McLeod status → our status (D-LMR7)", () => {
  it("A is uncovered, P dispatched, D delivered, V canceled", () => {
    expect(projectMcleodStatus("A", [])).toBe("pending_approval");
    expect(projectMcleodStatus("P", ["A", "A"])).toBe("approved");
    expect(projectMcleodStatus("D", [])).toBe("delivered");
    expect(projectMcleodStatus("V", [])).toBe("canceled");
  });
  it("P with a stop McLeod marks done is in transit", () => {
    expect(projectMcleodStatus("P", ["D", "A"])).toBe("in_transit");
  });
  it("an unknown McLeod status is refused, never defaulted", () => {
    expect(projectMcleodStatus("Q", [])).toBeNull();
    expect(projectMcleodStatus(null, [])).toBeNull();
    const r = projectMcleodMovement(movement({ movement_status: "Q" }), []);
    expect(r).toEqual({ ok: false, movement_id: "900", reason: "unknown McLeod status 'Q'" });
  });
});

describe("weight (D-LMR8)", () => {
  it("a McLeod 0 is 'not entered' and projects to null", () => {
    expect(projectWeightLbs(0, "LB")).toBeNull();
    expect(projectWeightLbs("0.0", "LB")).toBeNull();
  });
  it("a real pound weight passes through as a number, whatever form PostgREST returns it in", () => {
    expect(projectWeightLbs("42000.0", "LB")).toBe(42000);
    expect(projectWeightLbs(42000, "LB ")).toBe(42000);
  });
  it("a weight in any other unit is not written as pounds", () => {
    expect(projectWeightLbs(19000, "KG")).toBeNull();
    expect(projectWeightLbs(19000, null)).toBeNull();
  });
  it("0 pieces is 'not entered' too", () => {
    expect(ok(movement({ pieces: 0 }), []).pieces).toBeNull();
    expect(ok(movement(), []).pieces).toBe(24);
  });
});

describe("the load", () => {
  it("keys on company:movement, the same external_id the load feed always used", () => {
    expect(ok(movement(), []).external_id).toBe("TMS:900");
  });
  it("carries McLeod's words beside ours: status letter, customer, consignee, L as loaded", () => {
    const l = ok(movement(), []);
    expect(l).toMatchObject({ external_status: "P", customer_code: "BATTSOL", consignee_ref: "PO-77", loaded: true, equipment: "Reefer" });
    expect(ok(movement({ loaded: "E" }), []).loaded).toBe(false);
    expect(ok(movement({ loaded: null }), []).loaded).toBeNull();
  });
  it("a movement with no order is not a load we can show — refused with the reason", () => {
    expect(projectMcleodMovement(movement({ order_id: null }), [])).toMatchObject({ ok: false, reason: "no order attached" });
  });
  it("names the first of a team and says so", () => {
    const r = projectMcleodMovement(movement({ driver_codes: ["DKELLY", "JSMITH"] }), []);
    expect(r.ok && r.load.driver_code).toBe("DKELLY");
    expect(r.ok && r.notes.join()).toMatch(/team DKELLY, JSMITH/);
  });
});

describe("stops", () => {
  it("draws PU and SO in McLeod's order, keeping McLeod's sequence numbers; VA/SP stay in raw with a note", () => {
    const r = projectMcleodMovement(movement(), [
      stop({ stop_id: "c", movement_sequence: 3, stop_type: "SO" }),
      stop({ stop_id: "b", movement_sequence: 2, stop_type: "VA" }),
      stop(),
    ]);
    expect(r.ok && r.load.stops.map((s) => [s.seq, s.kind])).toEqual([[1, "pickup"], [3, "dropoff"]]);
    expect(r.ok && r.notes.join()).toMatch(/type 'VA' kept in raw/);
  });
  it("uses McLeod's real stop name, and falls back to city/state only when it has none", () => {
    expect(ok(movement(), [stop()]).stops[0]!.name).toBe("BATTERY SOLUTIONS");
    expect(ok(movement(), [stop({ location_name: null })]).stops[0]!.name).toBe("Howell, MI");
  });
  it("maps McLeod's actuals, ETA and contact to their own columns — never into the driver's arrived_at", () => {
    const s = ok(movement(), [stop({ actual_arrival: "2026-09-30T21:52:00+00:00", eta: "2026-09-30T21:45:00+00:00", phone: "5555550100", ponum: "PO-9" })]).stops[0]!;
    expect(s).toMatchObject({ actual_arrival_at: "2026-09-30T21:52:00+00:00", eta_at: "2026-09-30T21:45:00+00:00", contact_phone: "5555550100", po_number: "PO-9" });
    expect(Object.keys(s)).not.toContain("arrived_at");
  });
  it("coordinates arrive as numbers", () => {
    const s = ok(movement(), [stop()]).stops[0]!;
    expect([s.lat, s.lon]).toEqual([42.6, -83.93]);
  });
});
