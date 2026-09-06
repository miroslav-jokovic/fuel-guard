import { describe, it, expect } from "vitest";
import { allTimeCoverage } from "./useDashboard";

/**
 * D-SAM7 — the all-time share on the coverage tile, and the one way it lies.
 *
 * The arithmetic is `coverageFromBuckets` in `@silvicom/shared`, tested there and pinned against the
 * SQL that feeds it by the `telematics-coverage-buckets` matrix. What is only testable HERE is the
 * edge this composable owns: **what the tile shows when there is no answer.** `pct(n, d)` returns 0
 * for an empty denominator — correct for a per-month row, and on this tile it reads as "nothing this
 * carrier has ever bought has been corroborated", which is a serious claim to make because an RPC
 * failed.
 *
 * ⚠ Found by rendering the Dashboard against an empty result and reading the tile, not by a unit
 * test. The first version of this code passed `coveragePct` straight through and printed "0% all
 * time"; the assertions written for it covered `undefined` and an error, and neither is the shape a
 * successful-but-empty read arrives in.
 */
describe("allTimeCoverage", () => {
  const cells = [
    { month: "2026-08", attempted: true, status: "success", fills: 900 },
    { month: "2026-08", attempted: false, status: null, fills: 100 },
    { month: "2026-01", attempted: false, status: null, fills: 3000 },
  ];

  it("is the share of the whole history that was corroborated", () => {
    // 900 of 4,000 — the shape production had on 2026-09-01, where 90 days read ~95%.
    expect(allTimeCoverage({ data: cells, error: null })).toBe(22.5);
  });

  it("is unknown, not zero, when the read succeeded and returned nothing", () => {
    expect(allTimeCoverage({ data: [], error: null })).toBeNull();
  });

  it("is unknown when the read failed", () => {
    // Same rule, not a second branch: supabase-js nulls `data` on a failed call, so "no fills" is
    // what a failure looks like from here. An `if (error)` above it could not be made to fail.
    expect(allTimeCoverage({ data: null, error: { message: "connection reset" } })).toBeNull();
  });

  it("adds the cells Postgres returned separately for one month", () => {
    // `group by (month, attempted, status)` splits a month across rows; taking one cell per month
    // would report a fraction of the history as the whole of it.
    expect(allTimeCoverage({ data: cells.filter((c) => c.month === "2026-08"), error: null })).toBe(90);
  });

  it("reads counts that arrived as text rather than CONCATENATING them", () => {
    // ⚠ Two cells, and they have to disagree. With one cell an untouched string cancels out —
    // numerator and denominator are the same value — and the assertion passes while proving nothing.
    // Across two, `0 + "8" + "2"` is "082", so the total reads 82 against 8 corroborated: 9.8%.
    expect(allTimeCoverage({
      data: [
        { month: "2026-08", attempted: true, status: "success", fills: "8" },
        { month: "2026-08", attempted: false, status: null, fills: "2" },
      ],
      error: null,
    })).toBe(80);
  });
});
