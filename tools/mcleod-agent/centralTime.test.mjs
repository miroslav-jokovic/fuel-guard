import test from "node:test";
import assert from "node:assert/strict";
import { centralToIso } from "./centralTime.mjs";

// Every McLeod time passes through centralToIso, so each expectation here is written as the instant a
// dispatcher in Central would recognise, never as a copy of what the function returned.

test("the production case: 17:00 in McLeod is 17:00 Central, 22:00 UTC — not 17:00 UTC", () => {
  // Order 0135527, stop 2, measured 2026-09-24: stored in production as 17:00 UTC, i.e. noon Central.
  assert.equal(centralToIso("2026-09-30T17:00:00"), "2026-09-30T22:00:00.000Z");
});

test("across the 2026-11-01 change the same wall hour moves one hour in UTC", () => {
  assert.equal(centralToIso("2026-10-31T12:00:00"), "2026-10-31T17:00:00.000Z", "CDT, UTC-5");
  assert.equal(centralToIso("2026-11-02T12:00:00"), "2026-11-02T18:00:00.000Z", "CST, UTC-6");
});

test("the minutes around the November change: 01:59 CDT, the repeated hour, then 03:00 CST", () => {
  assert.equal(centralToIso("2026-11-01T00:59:00"), "2026-11-01T05:59:00.000Z");
  // 01:30 happens twice that night; the first pass (CDT) is the one kept.
  assert.equal(centralToIso("2026-11-01T01:30:00"), "2026-11-01T06:30:00.000Z");
  assert.equal(centralToIso("2026-11-01T03:00:00"), "2026-11-01T09:00:00.000Z");
});

test("the March gap: 02:30 does not exist in Central and resolves to 01:30 CST, stated rather than refused", () => {
  assert.equal(centralToIso("2027-03-14T01:59:00"), "2027-03-14T07:59:00.000Z", "last CST minute");
  assert.equal(centralToIso("2027-03-14T02:30:00"), "2027-03-14T07:30:00.000Z", "inside the gap");
  assert.equal(centralToIso("2027-03-14T03:00:00"), "2027-03-14T08:00:00.000Z", "first CDT minute");
});

test("midnight and the year boundary carry the date forward", () => {
  assert.equal(centralToIso("2026-12-31T23:30:00"), "2027-01-01T05:30:00.000Z");
});

test("no time is null, and the empty string is no time", () => {
  assert.equal(centralToIso(null), null);
  assert.equal(centralToIso(undefined), null);
  assert.equal(centralToIso(""), null);
});

test("a value that already names a zone is refused, never shifted a second time", () => {
  assert.throws(() => centralToIso("2026-09-30T17:00:00Z"), /zoneless/);
  assert.throws(() => centralToIso("2026-09-30T17:00:00-05:00"), /zoneless/);
  assert.throws(() => centralToIso("2026-09-30 17:00:00"), /zoneless/);
  assert.throws(() => centralToIso(new Date("2026-09-30T17:00:00Z")), /zoneless/);
});
