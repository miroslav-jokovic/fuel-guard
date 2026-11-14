import test from "node:test";
import assert from "node:assert/strict";
import { JOBS, dueJobs, lastDailyAnchor, serviceJobs, zonedHourToUtc } from "./schedule.mjs";

/** The cadences the letter to the carrier promises (section 3), pinned. */
const T = Date.parse("2026-09-24T15:00:00Z"); // 10:00 Central, a working morning
const MIN = 60_000;

/** The schedule as the Board VM runs it: finance on, lumper not switched on (no LUMPER_FEED line there). */
const VM = serviceJobs({ financeFeed: true, lumperFeed: false });
const WITH_LUMPER = serviceJobs({ financeFeed: true, lumperFeed: true });

test("a first start runs loads, close, roster and retire, one list, loads first", () => {
  assert.deepEqual(dueJobs(T, { financial: { succeededAt: T, attemptedAt: T } }, VM), ["loads", "close", "roster", "retire"]);
});

test("the lumper read is scheduled only when its switch is on, and finance only when its switch is not off", () => {
  const names = (o) => serviceJobs(o).map((j) => j.name);
  assert.deepEqual(names({ financeFeed: true, lumperFeed: false }), ["loads", "close", "roster", "retire", "financial"]);
  assert.deepEqual(names({ financeFeed: true, lumperFeed: true }), ["loads", "close", "roster", "retire", "lumper", "financial"]);
  assert.deepEqual(names({ financeFeed: false, lumperFeed: false }), ["loads", "close", "roster", "retire"]);
  assert.deepEqual(names({ financeFeed: false, lumperFeed: true }), ["loads", "close", "roster", "retire", "lumper"]);
});

test("switched on, the lumper read runs once an hour, counted from its last attempt, after the board's feeds", () => {
  assert.equal(JOBS.find((j) => j.name === "lumper").everyMs, 60 * MIN);
  const never = { financial: { succeededAt: T, attemptedAt: T } };
  assert.deepEqual(dueJobs(T, never, WITH_LUMPER), ["loads", "close", "roster", "retire", "lumper"]);
  const ran = { ...never, loads: { attemptedAt: T }, close: { attemptedAt: T }, roster: { attemptedAt: T }, retire: { attemptedAt: T }, lumper: { attemptedAt: T } };
  assert.ok(!dueJobs(T + 59 * MIN, ran, WITH_LUMPER).includes("lumper"));
  assert.ok(dueJobs(T + 60 * MIN, ran, WITH_LUMPER).includes("lumper"));
  // A failed read waits the hour like a good one: a refused table is not asked for again every tick.
  const failed = { ...ran, lumper: { attemptedAt: T, succeededAt: null, lastError: "permission denied" } };
  assert.ok(!dueJobs(T + 30 * MIN, failed, WITH_LUMPER).includes("lumper"));
});

test("switched off, the lumper read is never due, whatever the service remembers about it", () => {
  for (const at of [T, T + 60 * MIN, T + 24 * 60 * MIN]) assert.ok(!dueJobs(at, {}, VM).includes("lumper"));
});

test("loads every minute, close every ten, roster every fifteen, retire with it — counted from the last attempt", () => {
  const runs = {
    loads: { attemptedAt: T },
    close: { attemptedAt: T },
    roster: { attemptedAt: T },
    retire: { attemptedAt: T },
    financial: { succeededAt: T, attemptedAt: T },
  };
  assert.deepEqual(dueJobs(T + 59_999, runs, VM), []);
  assert.deepEqual(dueJobs(T + MIN, runs, VM), ["loads"]);
  assert.deepEqual(dueJobs(T + 10 * MIN, runs, VM), ["loads", "close"]);
  assert.deepEqual(dueJobs(T + 15 * MIN, runs, VM), ["loads", "close", "roster", "retire"]);
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
