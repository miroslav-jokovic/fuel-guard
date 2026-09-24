import test from "node:test";
import assert from "node:assert/strict";
import { dueJobs, lastDailyAnchor, zonedHourToUtc } from "./schedule.mjs";

/** The cadences the letter to the carrier promises (section 3), pinned. */
const T = Date.parse("2026-09-24T15:00:00Z"); // 10:00 Central, a working morning
const MIN = 60_000;

test("a first start runs loads, close and roster, one list, loads first", () => {
  assert.deepEqual(dueJobs(T, { financial: { succeededAt: T, attemptedAt: T } }), ["loads", "close", "roster"]);
});

test("loads every minute, close every ten, roster every fifteen — counted from the last attempt", () => {
  const runs = {
    loads: { attemptedAt: T },
    close: { attemptedAt: T },
    roster: { attemptedAt: T },
    financial: { succeededAt: T, attemptedAt: T },
  };
  assert.deepEqual(dueJobs(T + 59_999, runs), []);
  assert.deepEqual(dueJobs(T + MIN, runs), ["loads"]);
  assert.deepEqual(dueJobs(T + 10 * MIN, runs), ["loads", "close"]);
  assert.deepEqual(dueJobs(T + 15 * MIN, runs), ["loads", "close", "roster"]);
});

test("a failed feed waits its normal interval instead of retrying every tick", () => {
  const runs = { loads: { attemptedAt: T, succeededAt: null }, financial: { succeededAt: T, attemptedAt: T } };
  assert.ok(!dueJobs(T + 5_000, runs).includes("loads"));
});

test("finance runs once a night at 02:00 Central, not during the day", () => {
  const ranLastNight = { financial: { succeededAt: Date.parse("2026-09-24T07:05:00Z"), attemptedAt: Date.parse("2026-09-24T07:00:00Z") } };
  assert.ok(!dueJobs(T, ranLastNight).includes("financial"), "not again at 10:00");
  assert.ok(!dueJobs(Date.parse("2026-09-25T06:59:00Z"), ranLastNight).includes("financial"), "not at 01:59 CDT");
  assert.ok(dueJobs(Date.parse("2026-09-25T07:00:00Z"), ranLastNight).includes("financial"), "due at 02:00 CDT");
});

test("a failed night retries every thirty minutes until it succeeds", () => {
  const night = Date.parse("2026-09-25T07:00:00Z");
  const failed = { financial: { succeededAt: Date.parse("2026-09-24T07:05:00Z"), attemptedAt: night } };
  assert.ok(!dueJobs(night + 29 * MIN, failed).includes("financial"));
  assert.ok(dueJobs(night + 30 * MIN, failed).includes("financial"));
});

test("02:00 Central is 07:00 UTC in daylight time and 08:00 UTC after the clocks go back", () => {
  assert.equal(new Date(zonedHourToUtc(2026, 10, 31, 2)).toISOString(), "2026-10-31T07:00:00.000Z");
  assert.equal(new Date(zonedHourToUtc(2026, 11, 1, 2)).toISOString(), "2026-11-01T08:00:00.000Z");
  assert.equal(new Date(zonedHourToUtc(2027, 1, 15, 2)).toISOString(), "2027-01-15T08:00:00.000Z");
});

test("the anchor is today's 02:00 once it has passed, yesterday's before", () => {
  assert.equal(new Date(lastDailyAnchor(Date.parse("2026-09-24T06:59:00Z"), 2)).toISOString(), "2026-09-23T07:00:00.000Z");
  assert.equal(new Date(lastDailyAnchor(Date.parse("2026-09-24T07:00:00Z"), 2)).toISOString(), "2026-09-24T07:00:00.000Z");
});
