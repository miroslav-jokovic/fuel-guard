// The agent's first tests (D-FIN4). Plain node:test so they run on the carrier's Node the same
// way the agent does — no vitest, no workspace. Wired into CI through `lint:agent-syntax`.
//   node --test tools/mcleod-agent/
import { test } from "node:test";
import assert from "node:assert/strict";
import { financialWindow, monthsTouching, firstOfMonth, HARDEN_MONTHS_BACK } from "./windows.mjs";

const at = (iso) => new Date(iso);

test("monthsTouching lists every calendar month a window touches, whole, across a year end", () => {
  assert.deepEqual(monthsTouching("2025-11-20", "2026-02-03"), [
    { periodStart: "2025-11-01", periodEnd: "2025-12-01" },
    { periodStart: "2025-12-01", periodEnd: "2026-01-01" },
    { periodStart: "2026-01-01", periodEnd: "2026-02-01" },
    { periodStart: "2026-02-01", periodEnd: "2026-03-01" },
  ]);
  // A window ending exactly on a month boundary does not touch that month.
  assert.deepEqual(monthsTouching("2026-06-10", "2026-07-01"), [{ periodStart: "2026-06-01", periodEnd: "2026-07-01" }]);
});

test("firstOfMonth walks backwards across a year end", () => {
  assert.equal(firstOfMonth(at("2026-01-15T12:00:00Z"), -2), "2025-11-01");
  assert.equal(firstOfMonth(at("2026-09-03T12:00:00Z"), 0), "2026-09-01");
});

test("a mid-month run sweeps a trailing 75 days ending tomorrow, and is not a hardening pass", () => {
  const w = financialWindow({ now: at("2026-09-15T18:00:00Z") });
  assert.equal(w.windowEnd, "2026-09-16");
  assert.equal(w.windowStart, "2026-07-03"); // 75 days before the 16th
  assert.equal(w.hardening, false);
});

test("on the first three days of a month the two previous months are covered WHOLE, whatever the window setting", () => {
  for (const day of ["01", "02", "03"]) {
    // A short window (30 days) would reach only into August; the hardening pass pulls it back to July 1.
    const short = financialWindow({ now: at(`2026-09-${day}T02:00:00Z`), trailingDays: 30 });
    assert.equal(short.hardening, true, `day ${day}`);
    assert.equal(short.windowStart, "2026-07-01", `day ${day}`);
    // The default 75 days already reaches past July 1 on these days; the earlier start is kept, and
    // the pass is still reported so the log says which kind of run this was.
    const dflt = financialWindow({ now: at(`2026-09-${day}T02:00:00Z`) });
    assert.equal(dflt.hardening, true, `day ${day}`);
    assert.ok(dflt.windowStart <= "2026-07-01", `day ${day}: ${dflt.windowStart}`);
  }
  const fourth = financialWindow({ now: at("2026-09-04T02:00:00Z"), trailingDays: 30 });
  assert.equal(fourth.hardening, false);
  assert.equal(fourth.windowStart, "2026-08-06");
});

test("--harden forces the pass on any day; the trailing window still wins when it already reaches further", () => {
  const forced = financialWindow({ now: at("2026-09-15T18:00:00Z"), harden: true, trailingDays: 30 });
  assert.equal(forced.hardening, true);
  assert.equal(forced.windowStart, "2026-07-01");
  // A trailing window longer than the hardening reach keeps its own start.
  const long = financialWindow({ now: at("2026-09-02T18:00:00Z"), trailingDays: 250 });
  assert.equal(long.hardening, true);
  assert.equal(long.windowStart, "2025-12-27"); // 250 days before 2026-09-03
  assert.equal(HARDEN_MONTHS_BACK, 2);
});

test("a hardening window on the 1st covers exactly the two previous months as whole calendar months", () => {
  const w = financialWindow({ now: at("2026-03-01T06:00:00Z"), trailingDays: 30 });
  const months = monthsTouching(w.windowStart, w.windowEnd).map((m) => m.periodStart);
  assert.deepEqual(months, ["2026-01-01", "2026-02-01", "2026-03-01"]);
});
