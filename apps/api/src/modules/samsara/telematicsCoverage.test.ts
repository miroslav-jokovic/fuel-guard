import { describe, it, expect } from "vitest";
import { readTelematicsCoverage } from "./telematicsCoverage.js";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";

/**
 * The figure the 90-day window was hiding, now counted in one round trip (SAM-S4 / Q-SAM8).
 *
 * ⚠ WHAT THIS FILE CAN AND CANNOT SEE, SINCE 0322. The population filter (`vehicle_id is not null`),
 * the month expression and the absence of a window all moved into `telematics_coverage_buckets()`.
 * They are not unasserted — the `telematics-coverage-buckets` matrix runs them against real Postgres,
 * where a `group by` and a JavaScript `Map` can be compared — but they are no longer visible from
 * here, and three assertions that used to live in this file were deleted rather than left as query
 * inspections that now inspect nothing. What is still only testable HERE is the seam: which function
 * is called, with which org, and what happens when the call fails.
 */

const ORG = "org-1";
const cell = (month: string | null, attempted: boolean, status: string | null, fills: number) => ({
  month, attempted, status, fills,
});

/** The recorder passes a scripted `{ error }` through as a failed call; anything else is the data. */
const recorderFor = (data: unknown, error: unknown = null) =>
  createSupabaseRecorder({ rpc: { telematics_coverage_buckets: error ? { error } : data } });

describe("readTelematicsCoverage", () => {
  it("reports the three states separately, over the whole history", async () => {
    const rec = recorderFor([
      cell("2026-08", true, "success", 1),
      cell("2026-01", true, "no_data", 1),
      cell("2026-03", false, null, 1),
    ]);
    const r = await readTelematicsCoverage(rec.client, ORG);
    expect(r).toMatchObject({ fills: 3, reconciled: 1, noData: 1, pending: 1 });
    expect(r.byMonth.map((m) => m.month)).toEqual(["2026-08", "2026-03", "2026-01"]);
  });

  it("counts in the database rather than paging the history to this process", async () => {
    // The whole of Q-SAM8 in one assertion. This used to be a `.from(\"fuel_transactions\")` loop that
    // cost 16 sequential round trips over 15,948 production rows, which is why D-SAM7 could not put
    // the number on the Dashboard. A single `.from()` read reappearing here is that cost returning.
    const rec = recorderFor([cell("2026-08", true, "success", 5)]);
    await readTelematicsCoverage(rec.client, ORG);
    expect(rec.rpcs().map((r) => r.fn)).toEqual(["telematics_coverage_buckets"]);
    expect(rec.forTable("fuel_transactions")).toHaveLength(0);
  });

  it("scopes the read to one org — the service role bypasses RLS, so p_org is the whole boundary", async () => {
    // ⚠ Asserted on the ARGUMENT, not with `expectOrgScoped`: that helper skips `rpc:` queries by
    // construction, so calling it here would pass whatever this function did. An assertion that
    // silently starts passing for everything is worse than no assertion.
    const rec = recorderFor([]);
    await readTelematicsCoverage(rec.client, ORG);
    expect(rec.rpcs()[0]!.args).toEqual({ p_org: ORG });
  });

  it("adds the cells Postgres returned separately for one month", async () => {
    // `group by (month, attempted, status)` means a month arrives as several rows. Taking the last
    // cell per month instead of summing would report a fraction of every month.
    const r = await readTelematicsCoverage(
      recorderFor([
        cell("2026-08", true, "success", 6),
        cell("2026-08", true, "no_data", 2),
        cell("2026-08", false, null, 2),
      ]).client,
      ORG,
    );
    expect(r).toMatchObject({ fills: 10, reconciled: 6, noData: 2, pending: 2 });
    expect(r.byMonth[0]!.coveragePct).toBe(60);
  });

  it("reads a count that arrived as text rather than propagating a silent NaN", async () => {
    // PostgREST returns `int` as a number today. If a driver, a view or a cast ever changed that, an
    // untouched `fills` would make every percentage NaN — which renders as "—", not as an error.
    const r = await readTelematicsCoverage(
      recorderFor([{ month: "2026-08", attempted: true, status: "success", fills: "7" }]).client,
      ORG,
    );
    expect(r.fills).toBe(7);
    expect(r.coveragePct).toBe(100);
  });

  it("surfaces a read failure rather than reporting 0% coverage", async () => {
    // A swallowed error here would render as "0% corroborated" — an alarming number with no cause,
    // which is the same class of lie as the windowed 95%.
    await expect(
      readTelematicsCoverage(recorderFor(null, { message: "connection reset" }).client, ORG),
    ).rejects.toThrow("connection reset");
  });
});
