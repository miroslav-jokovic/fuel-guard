import { describe, expect, it } from "vitest";
import { allTimeCoveragePct } from "./telematicsCoverage.js";

/**
 * D-SAM7 — the all-time share on the coverage tile, and the one way it lies.
 *
 * These assertions moved here verbatim from `apps/web/src/features/dashboard/useDashboard.test.ts`
 * when the Dashboard's fold went server-side (queue item 5 step 4). The arithmetic is
 * `coverageFromBuckets`, tested beside this and pinned against the SQL that feeds it by the
 * `telematics-coverage-buckets` matrix; what is only testable HERE is **what the tile shows when
 * there is no answer**.
 *
 * ⚠ Found by rendering the Dashboard against an empty result and reading the tile, not by a unit
 * test. The first version passed `coveragePct` straight through and printed "0% all time"; the
 * assertions written for it covered `undefined` and an error, and neither is the shape a
 * successful-but-empty read arrives in.
 */
describe("allTimeCoveragePct", () => {
  const cells = [
    { month: "2026-08", attempted: true, status: "success", fills: 900 },
    { month: "2026-08", attempted: false, status: null, fills: 100 },
    { month: "2026-01", attempted: false, status: null, fills: 3000 },
  ];

  it("is the share of the whole history that was corroborated", () => {
    // 900 of 4,000 — the shape production had on 2026-09-01, where 90 days read ~95%.
    expect(allTimeCoveragePct(cells)).toBe(22.5);
  });

  it("is unknown, not zero, when the read succeeded and returned nothing", () => {
    expect(allTimeCoveragePct([])).toBeNull();
  });

  // Same rule, not a second branch: a failed read hands this nothing, and "no fills" is what a
  // failure looks like from here. An `if (error)` above it could not be made to fail.
  it("is unknown when there was no read at all", () => {
    expect(allTimeCoveragePct(null)).toBeNull();
    expect(allTimeCoveragePct(undefined)).toBeNull();
  });

  it("adds the cells Postgres returned separately for one month", () => {
    // `group by (month, attempted, status)` splits a month across rows; taking one cell per month
    // would report a fraction of the history as the whole of it.
    expect(allTimeCoveragePct(cells.filter((c) => c.month === "2026-08"))).toBe(90);
  });

  it("reads counts that arrived as text rather than CONCATENATING them", () => {
    // ⚠ Two cells, and they have to disagree. With one cell an untouched string cancels out —
    // numerator and denominator are the same value — and the assertion passes while proving nothing.
    // Across two, `0 + "8" + "2"` is "082", so the total reads 82 against 8 corroborated: 9.8%.
    expect(
      allTimeCoveragePct([
        { month: "2026-08", attempted: true, status: "success", fills: "8" as unknown as number },
        { month: "2026-08", attempted: false, status: null, fills: "2" as unknown as number },
      ]),
    ).toBe(80);
  });
});
