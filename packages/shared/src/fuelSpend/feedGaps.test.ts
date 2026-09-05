import { describe, it, expect } from "vitest";
import { detectFeedGaps, type FeedDayCount } from "./feedGaps.js";

/**
 * Holes in the middle of the fuel record (2026-09-05).
 *
 * ── THE HOLE THIS WAS BUILT FROM ────────────────────────────────────────────────────────────────
 * Production, 2026-02-01 to 2026-09-03: 215 days, and exactly 17 with no fill at all — one contiguous
 * block, 2026-04-18 to 2026-05-04. The raw vendor rows are missing for the same days, the fleet drove
 * normally throughout (Samsara's IFTA miles say so), and roughly 119,000 gallons and $590,000 of fuel
 * are simply absent from the record. **The freshness line was correct the whole time**: purchases had
 * arrived minutes ago, every day, for four months.
 *
 * So the cases below are the ways a detector like this fails quietly: reporting the edges of a window
 * as holes (wrong twice a day, which is how a warning becomes wallpaper), missing a hole because the
 * days were handed over unsorted, or inflating the estimate from one catch-up day.
 */
const day = (d: string, fills: number): FeedDayCount => ({ day: d, fills });

/** A fortnight where 04-05 to 04-07 delivered nothing. */
const WITH_HOLE: FeedDayCount[] = [
  day("2026-04-01", 60), day("2026-04-02", 62), day("2026-04-03", 58), day("2026-04-04", 61),
  day("2026-04-05", 0),  day("2026-04-06", 0),  day("2026-04-07", 0),
  day("2026-04-08", 59), day("2026-04-09", 63), day("2026-04-10", 60),
];

describe("detectFeedGaps", () => {
  it("finds the hole, dates it, and says what is probably in it", () => {
    const r = detectFeedGaps(WITH_HOLE);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]).toMatchObject({ from: "2026-04-05", to: "2026-04-07", days: 3, typicalFillsPerDay: 60 });
    expect(r.gaps[0]!.estimatedMissingFills).toBe(180);
    expect(r.lead).toMatch(/No fuel arrived at all for 3 days/);
    expect(r.lead).toMatch(/180 fills are missing rather than absent from the fleet/);
  });

  it("says nothing at all when the record has no holes", () => {
    // Silence is the pass. A line that appears on every visit is not read on the day it matters.
    const r = detectFeedGaps([day("2026-04-01", 60), day("2026-04-02", 62), day("2026-04-03", 58)]);
    expect(r.gaps).toEqual([]);
    expect(r.lead).toBeNull();
    expect(r.emptyDays).toBe(0);
  });

  it("does not call the EDGES of a window a gap", () => {
    // A window that starts before the carrier's first fill, or ends today before today's have
    // arrived, has empty days that mean "outside the record" rather than "missing from it". A gap
    // needs an edge on each side.
    const r = detectFeedGaps([
      day("2026-04-01", 0), day("2026-04-02", 0),
      day("2026-04-03", 60), day("2026-04-04", 61),
      day("2026-04-05", 0), day("2026-04-06", 0),
    ]);
    expect(r.gaps).toEqual([]);
    expect(r.coveredDays).toBe(2); // only 04-03 → 04-04 is inside the record
  });

  it("treats a day it never saw as empty, because the table not holding it is the point", () => {
    // The caller counts rows. A day with no rows produces no entry, and a detector that only looked
    // at rows it was given would never see a hole at all.
    const r = detectFeedGaps([day("2026-04-01", 60), day("2026-04-04", 60)]);
    expect(r.gaps[0]).toMatchObject({ from: "2026-04-02", to: "2026-04-03", days: 2 });
  });

  it("does not depend on the order the days arrive in", () => {
    const shuffled = [...WITH_HOLE].reverse();
    expect(detectFeedGaps(shuffled)).toEqual(detectFeedGaps(WITH_HOLE));
  });

  it("estimates from the MEDIAN, so one catch-up day cannot inflate the hole", () => {
    // The day after a feed comes back often carries the backlog. A mean would take that 900-fill day
    // as normal and claim three times the fuel is missing.
    const r = detectFeedGaps([
      day("2026-04-01", 60), day("2026-04-02", 60), day("2026-04-03", 0), day("2026-04-04", 900),
      day("2026-04-05", 60),
    ]);
    expect(r.gaps[0]!.typicalFillsPerDay).toBe(60);
    expect(r.gaps[0]!.estimatedMissingFills).toBe(60);
  });

  it("reports several holes and leads with the longest", () => {
    const r = detectFeedGaps([
      day("2026-04-01", 60), day("2026-04-02", 0), day("2026-04-03", 60),
      day("2026-04-04", 0), day("2026-04-05", 0), day("2026-04-06", 0), day("2026-04-07", 60),
    ]);
    expect(r.gaps.map((g) => g.days)).toEqual([1, 3]);
    expect(r.lead).toMatch(/Apr 4 – Apr 6 and 1 other gap/);
    expect(r.lead).toMatch(/for 4 days/);
  });

  it("can be told a bigger fleet's threshold, for a fleet that has quiet days", () => {
    // One empty day is already an event for ~165 tractors — measured, not assumed. Nine trucks have
    // quiet Sundays, and this rule should serve them without being rewritten.
    const oneDay = [day("2026-04-01", 6), day("2026-04-02", 0), day("2026-04-03", 6)];
    expect(detectFeedGaps(oneDay).gaps).toHaveLength(1);
    expect(detectFeedGaps(oneDay, { minGapDays: 2 }).gaps).toHaveLength(0);
  });

  it("has nothing to say about a record with fewer than two delivering days", () => {
    expect(detectFeedGaps([]).lead).toBeNull();
    expect(detectFeedGaps([day("2026-04-01", 60)]).lead).toBeNull();
  });

  it("reproduces the production hole this was built from", () => {
    // 2026-04-18 → 2026-05-04, seventeen days, with normal fuelling either side.
    const days: FeedDayCount[] = [];
    for (let t = Date.parse("2026-04-01T00:00:00Z"); t <= Date.parse("2026-05-20T00:00:00Z"); t += 86_400_000) {
      const d = new Date(t).toISOString().slice(0, 10);
      days.push(day(d, d >= "2026-04-18" && d <= "2026-05-04" ? 0 : 62));
    }
    const r = detectFeedGaps(days);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]).toMatchObject({ from: "2026-04-18", to: "2026-05-04", days: 17 });
    expect(r.gaps[0]!.estimatedMissingFills).toBe(1054);
  });
});
