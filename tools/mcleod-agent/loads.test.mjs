import test from "node:test";
import assert from "node:assert/strict";
import { mapLoad, mapDispatchers, toWesternLongitude } from "./loads.mjs";

const row = (over = {}) => ({
  external_id: "TMS:290227",
  ref: "0134754",
  bol_number: "TL1856603",
  dispatcher_external_id: "romann",
  dispatcher_name: "romann",
  driver_codes: "DKELLY",
  vehicle_unit: "702",
  trailer_unit: "536686",
  trailer_type: "R",
  commodity: "paints",
  total_miles: 812,
  external_status: "P",
  ...over,
});

const stop = (over = {}) => ({
  movement_id: "290227",
  seq: 1,
  stop_type: "PU",
  location_id: "THESCLO1",
  city: "Gallup",
  state: "NM",
  address_line: "1 Dock Rd",
  postal_code: "87301",
  lat: 35.525067,
  lon_west_positive: 108.585087,
  appointment_start: "2026-09-11T11:00:00",
  appointment_end: null,
  stop_status: "A",
  ...over,
});

// ── the single most dangerous line in this integration ────────────────────────────────────────
test("longitude is negated, because McLeod stores it west-positive", () => {
  // 0 of 119,962 rows over seven days carried a negative longitude; the range 68.39–123.39 against
  // latitudes 25.87–48.60 is the continental US with the sign dropped.
  assert.equal(toWesternLongitude(108.585087), -108.585087);
  assert.equal(mapLoad(row(), [stop()]).load.stops[0].lon, -108.585087);
});

test("an already-negative longitude is passed through, not negated twice", () => {
  assert.equal(toWesternLongitude(-108.585087), -108.585087);
});

test("a longitude outside the western hemisphere is refused rather than coerced", () => {
  assert.equal(toWesternLongitude(200), null);
  assert.equal(toWesternLongitude("not a number"), null);
});

// ── identity ──────────────────────────────────────────────────────────────────────────────────
test("external_id is company-qualified, because movement.id repeats across companies", () => {
  // 18,761 collisions across TMS/TMS2/TMS3; the ingest is keyed (org_id, provider, external_id).
  assert.equal(mapLoad(row(), []).load.external_id, "TMS:290227");
});

test("ref is the order id, never the BOL number", () => {
  // blnum collides 2,020 times in 134,315 orders and `loads` carries unique (org_id, ref).
  const { load } = mapLoad(row(), []);
  assert.equal(load.ref, "0134754");
  assert.equal(load.raw.bol_number, "TL1856603");
});

test("a movement with no order is skipped and reported, never sent without a ref", () => {
  const { load, skipped } = mapLoad(row({ ref: null }), []);
  assert.equal(load, null);
  assert.match(skipped.reason, /no order/);
});

// ── teams ─────────────────────────────────────────────────────────────────────────────────────
test("a team movement yields ONE load and reports the co-driver", () => {
  // 'D' appears twice on 176 movements. A LEFT JOIN would emit the movement twice.
  const { load, notes } = mapLoad(row({ driver_codes: "DKELLY,BMASSEY" }), []);
  assert.equal(load.driver_employee_id, "DKELLY");
  assert.equal(notes.length, 1);
  assert.match(notes[0], /team drivers DKELLY, BMASSEY/);
});

// ── stop vocabulary (D-LM15) ──────────────────────────────────────────────────────────────────
test("PU and SO map to pickup and dropoff", () => {
  const { load } = mapLoad(row(), [stop({ seq: 1, stop_type: "PU" }), stop({ seq: 2, stop_type: "SO" })]);
  assert.deepEqual(load.stops.map((s) => s.kind), ["pickup", "dropoff"]);
});

test("an unrecognised stop type is reported and NOT sent as a delivery", () => {
  // `kind` drives the driver's photo checklist: calling a yard move a delivery asks for a bill of
  // lading that does not exist.
  const { load, notes } = mapLoad(row(), [stop({ seq: 1, stop_type: "PU" }), stop({ seq: 2, stop_type: "VA" })]);
  assert.equal(load.stops.length, 1);
  assert.equal(load.stops[0].kind, "pickup");
  assert.match(notes[0], /type 'VA' — not sent/);
});

test("the stop name is composed from city and state, with the shipper code kept beside it", () => {
  const { load } = mapLoad(row(), [stop()]);
  assert.equal(load.stops[0].name, "Gallup, NM");
});

// ── the field McLeod does not know ────────────────────────────────────────────────────────────
test("hazmat is absent, never false, because McLeod does not record it", () => {
  // orders.hazmat reads 'Y' on 1 of 134,996 rows. The field is amendable, so a false would erase
  // what Silvicom's own rules engine determined.
  const { load } = mapLoad(row(), []);
  assert.equal(Object.hasOwn(load, "hazmat"), false);
});

// ── reefer comes from the trailer (D-LM13) ────────────────────────────────────────────────────
test("reefer is read from the trailer type, which is the only place it exists", () => {
  assert.equal(mapLoad(row({ trailer_type: "R" }), []).load.equipment, "Reefer");
  assert.equal(mapLoad(row({ trailer_type: "V" }), []).load.equipment, "Van");
  assert.equal(mapLoad(row({ trailer_type: null }), []).load.equipment, null);
});

// ── dispatchers ───────────────────────────────────────────────────────────────────────────────
test("is_system comes from configuration, not from the display name", () => {
  // `loadmaster` and `lmeadm` are BOTH named "McLeod Administrator"; matching on the name would
  // break the moment somebody renames one, and would catch a real person called the same thing.
  const rows = [
    { external_id: "romann  ", display_name: "romann", is_active: 1 },
    { external_id: "loadmaster", display_name: "McLeod Administrator", is_active: 1 },
  ];
  const out = mapDispatchers(rows, ["loadmaster", "lmeadm"]);
  assert.equal(out[0].is_system, false);
  assert.equal(out[0].external_id, "romann", "char(n) padding must be trimmed");
  assert.equal(out[1].is_system, true);
});

test("an account NOT in the configured list stays a person, whatever it is called", () => {
  // The discriminating case, and the reason this is configuration: an account can be named
  // "McLeod Administrator" without being a system account, and a system account can be renamed.
  // Inferring from the display name gets this wrong in both directions, silently.
  const rows = [{ external_id: "newadmin", display_name: "McLeod Administrator", is_active: 1 }];
  assert.equal(mapDispatchers(rows, ["loadmaster", "lmeadm"])[0].is_system, false);
});

test("an inactive dispatcher is carried as inactive rather than dropped", () => {
  const out = mapDispatchers([{ external_id: "old", display_name: "Old", is_active: 0 }], []);
  assert.equal(out[0].is_active, false);
});
