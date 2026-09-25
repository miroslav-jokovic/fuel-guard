import test from "node:test";
import assert from "node:assert/strict";
import { describeDryRun, describeMirrorDryRun } from "./dryRun.mjs";

// Two movements shaped as mapDispatchMovement returns them, carrying values distinctive enough that
// finding any of them in the output can only mean a row was printed.
const movements = [
  {
    movement_id: "1001", movement_status: "P", dispatcher_name: "Dana Dispatcher", commodity: "FROZEN PEAS",
    stops: [
      { stop_id: "S1", stop_type: "PU", location_name: "Viking Packing Dock 4", address_line: "1200 W Cold St",
        contact_name: "Pat Receiver", phone: "312-555-0142", ponum: "PO-778812" },
      { stop_id: "S2", stop_type: "SO", location_name: null, address_line: "9 Harbor Rd",
        contact_name: null, phone: null, ponum: null },
    ],
  },
  { movement_id: "1002", movement_status: "A", dispatcher_name: null, commodity: "", stops: [] },
];

const PRIVATE = [
  "Dana Dispatcher", "FROZEN PEAS", "Viking Packing Dock 4", "1200 W Cold St", "9 Harbor Rd",
  "Pat Receiver", "312-555-0142", "PO-778812",
];

test("the mirror dry run prints no stop address, contact, phone or PO — Alex's counts-only condition", () => {
  const out = describeMirrorDryRun(movements).join("\n");
  for (const v of PRIVATE) assert.ok(!out.includes(v), `printed ${v}`);
});

test("stops are counted as their own rows, so a partly named field reads n of the stop total", () => {
  const out = describeMirrorDryRun(movements);
  assert.ok(out.includes("\n### movements — 2 row(s) would be sent"));
  assert.ok(out.includes("\n### stops — 2 row(s) would be sent"));
  assert.ok(out.includes("     1/2  location_name  (1 without)"));
  assert.ok(out.includes("     2/2  address_line"));
  // A movement's stops are reported in the stops block, not as a field of the movement.
  assert.ok(!out.some((l) => /^\s+\d+\/2 {2}stops/.test(l)));
});

test("an empty string, a null and an empty array all count as absent", () => {
  const out = describeDryRun("movements", movements.map(({ stops, ...m }) => ({ ...m, extra: stops })));
  assert.ok(out.includes("     1/2  commodity  (1 without)"));
  assert.ok(out.includes("     1/2  dispatcher_name  (1 without)"));
  assert.ok(out.includes("     1/2  extra  (1 without)"));
});

test("a load dry run keeps no sample row; the roster's sample masks names, licence and address", () => {
  const driver = { external_id: "D7", first_name: "Sam", cdl_number: "X1234567", address_line1: "5 Elm", status: "A" };
  assert.ok(!describeDryRun("dispatchers", [driver]).some((l) => l.includes("sample")));
  const sample = describeDryRun("drivers", [driver], { sample: true }).at(-1);
  assert.equal(sample, '  sample: {"external_id":"D7","first_name":"‹masked›","cdl_number":"‹masked›","address_line1":"‹masked›","status":"A"}');
});

test("no rows prints the header alone", () => {
  assert.deepEqual(describeMirrorDryRun([]), [
    "\n### movements — 0 row(s) would be sent",
    "\n### stops — 0 row(s) would be sent",
  ]);
});
