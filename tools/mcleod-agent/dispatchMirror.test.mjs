import test from "node:test";
import assert from "node:assert/strict";
import { assemble, mapLoad, mapDispatchMovement } from "./loads.mjs";

// The raw mirror (LOADS-MIRROR-PLAN.md LR3): what McLeod said, verbatim, for `mcleod_dispatch_*`.
// Fixtures are shaped as DISPATCH_LOADS / DISPATCH_LOAD_STOPS return them.

const row = (over = {}) => ({
  external_id: "TMS:290227",
  company_id: "TMS",
  movement_id: "290227",
  ref: "0134754",
  bol_number: "TL1856603",
  dispatcher_external_id: "romann",
  driver_codes: "DKELLY,JSMITH",
  vehicle_unit: "702",
  trailer_unit: "536686",
  trailer_type: "R",
  commodity: "paints",
  total_miles: 812,
  external_status: "P",
  loaded: "L",
  customer_id: "BATTSOL",
  weight: 42000,
  weight_um: "LB",
  pieces: 24,
  pallets_how_many: 22,
  consignee_refno: "PO-77",
  ...over,
});

const stop = (over = {}) => ({
  movement_id: "290227",
  stop_id: "zz1A2B3C",
  seq: 1,
  stop_type: "PU",
  location_id: "BATTSOL1",
  location_name: "BATTERY SOLUTIONS",
  city: "Howell",
  state: "MI",
  address_line: "1 Dock Rd",
  postal_code: "48843",
  lat: 42.6,
  lon_west_positive: 83.93,
  appointment_start: "2026-09-30T17:00:00",
  appointment_end: "2026-09-30T19:00:00",
  actual_arrival: "2026-09-30T16:52:00",
  actual_departure: null,
  eta: "2026-09-30T16:45:00",
  contact_name: "Dock office",
  phone: "5555550100",
  ponum: "PO-77",
  stop_status: "D",
  ...over,
});

test("every stop is mirrored, VA and SP included, with its type exactly as McLeod wrote it", () => {
  const stops = [stop(), stop({ stop_id: "s2", seq: 2, stop_type: "VA" }), stop({ stop_id: "s3", seq: 3, stop_type: "SP" }),
    stop({ stop_id: "s4", seq: 4, stop_type: "SO" })];
  const m = mapDispatchMovement(row(), stops);
  assert.deepEqual(m.stops.map((s) => s.stop_type), ["PU", "VA", "SP", "SO"]);
  // …while the load feed still drops the two it cannot draw (D-LM15): the two feeds disagree on purpose.
  assert.equal(mapLoad(row(), stops).load.stops.length, 2);
});

test("every McLeod stop time is converted from Central once — 17:00 in McLeod is 22:00Z", () => {
  const [s] = mapDispatchMovement(row(), [stop()]).stops;
  assert.equal(s.sched_arrive_early, "2026-09-30T22:00:00.000Z");
  assert.equal(s.sched_arrive_late, "2026-10-01T00:00:00.000Z", "19:00 Central is midnight UTC — the date moves");
  assert.equal(s.actual_arrival, "2026-09-30T21:52:00.000Z");
  assert.equal(s.eta, "2026-09-30T21:45:00.000Z");
  assert.equal(s.actual_departure, null, "no departure yet is null, not the epoch");
});

test("the load feed's appointment is converted the same way — the fix for the five-hour offset", () => {
  assert.equal(mapLoad(row(), [stop()]).load.stops[0].appointment_start, "2026-09-30T22:00:00.000Z");
});

test("longitude arrives west-negative, as the raw table's CHECK demands", () => {
  assert.equal(mapDispatchMovement(row(), [stop()]).stops[0].longitude, -83.93);
});

test("the movement keeps McLeod's names and values: both team drivers, the L/E letter, weight and its unit", () => {
  const m = mapDispatchMovement(row(), []);
  assert.equal(m.movement_id, "290227");
  assert.equal(m.order_id, "0134754");
  assert.deepEqual(m.driver_codes, ["DKELLY", "JSMITH"]);
  assert.equal(m.loaded, "L");
  assert.equal(m.weight, 42000);
  assert.equal(m.weight_um, "LB");
  assert.equal(m.pallets_how_many, 22);
  assert.equal(m.move_distance, 812);
});

test("a weight McLeod recorded as 0 stays 0 — whether it means 'not entered' is LR4's ruling, not the reader's", () => {
  assert.equal(mapDispatchMovement(row({ weight: 0 }), []).weight, 0);
});

test("no weight is null, and so is its unit — a unit alone describes nothing", () => {
  const m = mapDispatchMovement(row({ weight: null, weight_um: "LB", pieces: null }), []);
  assert.equal(m.weight, null);
  assert.equal(m.weight_um, null);
  assert.equal(m.pieces, null);
});

test("a movement with no order is still mirrored — the load feed skips it, the raw copy keeps it", () => {
  const out = assemble([row({ ref: null })], []);
  assert.equal(out.loads.length, 0);
  assert.equal(out.movements.length, 1);
  assert.equal(out.movements[0].order_id, null);
});

test("a movement on two orders is refused for the mirror and said out loud, never stored with one of them", () => {
  const out = assemble([row(), row({ ref: "0134755" }), row({ external_id: "TMS:1", movement_id: "1" })], []);
  assert.deepEqual(out.movements.map((m) => m.movement_id), ["1"]);
  assert.equal(out.skipped.filter((s) => s.movement_id === "290227").length, 1);
  assert.match(out.skipped.find((s) => s.movement_id === "290227").reason, /2 orders/);
});

test("stops are stitched to their own movement only", () => {
  const out = assemble(
    [row(), row({ external_id: "TMS:1", movement_id: "1" })],
    [stop(), stop({ movement_id: "1", stop_id: "other" })],
  );
  assert.deepEqual(out.movements.map((m) => m.stops.map((s) => s.stop_id)), [["zz1A2B3C"], ["other"]]);
});
