import { describe, it, expect } from "vitest";
import { computeTelematicsCoverage, type TelematicsCoverageInput } from "./samsara/telematicsCoverage.js";

const fill = (
  fueled_at: string | null,
  state: "reconciled" | "no_data" | "pending",
): TelematicsCoverageInput => ({
  fueled_at,
  samsara_recon_at: state === "pending" ? null : "2026-09-02T01:15:00Z",
  samsara_recon_status: state === "reconciled" ? "success" : state === "no_data" ? "no_data" : null,
});

describe("computeTelematicsCoverage — a backlog and a dead end are not the same gap", () => {
  it("separates never-asked from asked-and-nothing-there", () => {
    const s = computeTelematicsCoverage([
      fill("2026-08-05T12:00:00Z", "reconciled"),
      fill("2026-08-06T12:00:00Z", "no_data"),
      fill("2026-08-07T12:00:00Z", "pending"),
    ]);
    expect(s).toMatchObject({ fills: 3, reconciled: 1, noData: 1, pending: 1 });
    // One in three corroborated. The other two are missing for reasons that need different actions:
    // one waits for the collector, one never improves.
    expect(s.coveragePct).toBe(33.3);
  });

  // The predicate that matters: `samsara_recon_at` is stamped whether or not Samsara had anything, so
  // a `no_data` row is ATTEMPTED. Reading `samsara_recon_status` alone would call it never-attempted
  // and re-queue it forever — the three predicates differ by over a thousand rows in production.
  it("counts a no_data row as attempted, not as pending", () => {
    const s = computeTelematicsCoverage([fill("2026-01-15T12:00:00Z", "no_data")]);
    expect(s.pending).toBe(0);
    expect(s.noData).toBe(1);
  });

  // ⚠ THE CASE THAT SEPARATES THE TWO PREDICATES, and there are 124 of these rows in production
  // (measured 2026-09-02): a status was written but the `samsara_recon_at` stamp never landed. Judging
  // by `samsara_recon_status` instead would call this row done and never look at it again; judging by
  // the stamp re-queues it, which costs one vendor call and is the at-least-once direction the whole
  // collector is built on. Without this fixture BOTH predicates pass every other test in this file.
  it("a status with no stamp is still PENDING — the stamp is what 'we asked' means", () => {
    const s = computeTelematicsCoverage([
      { fueled_at: "2026-05-01T12:00:00Z", samsara_recon_status: "success", samsara_recon_at: null },
    ]);
    expect(s).toMatchObject({ pending: 1, reconciled: 0, noData: 0 });
  });

  it("groups by UTC month, newest first, and keeps each month's own rate", () => {
    const s = computeTelematicsCoverage([
      fill("2026-01-15T12:00:00Z", "no_data"),
      fill("2026-01-16T12:00:00Z", "reconciled"),
      fill("2026-08-15T12:00:00Z", "reconciled"),
      fill("2026-08-16T12:00:00Z", "reconciled"),
    ]);
    expect(s.byMonth.map((m) => m.month)).toEqual(["2026-08", "2026-01"]);
    // Exactly the shape production shows: the old month carries the vendor-side gap, the new one does
    // not. A single blended 75% would hide which is which.
    expect(s.byMonth[0]).toMatchObject({ month: "2026-08", coveragePct: 100, noData: 0 });
    expect(s.byMonth[1]).toMatchObject({ month: "2026-01", coveragePct: 50, noData: 1 });
  });

  it("reports where coverage LANDS if the backlog resolves at the rate already observed", () => {
    // 8 attempted, 6 of them with history (75%). 12 still pending. If they behave like the 8, the
    // final figure is 6 + 9 = 15 of 20 = 75% — not the 30% the raw number reads today.
    const rows = [
      ...Array.from({ length: 6 }, () => fill("2026-03-01T00:00:00Z", "reconciled")),
      ...Array.from({ length: 2 }, () => fill("2026-03-01T00:00:00Z", "no_data")),
      ...Array.from({ length: 12 }, () => fill("2026-03-01T00:00:00Z", "pending")),
    ];
    const s = computeTelematicsCoverage(rows);
    expect(s.coveragePct).toBe(30);
    expect(s.attainablePct).toBe(75);
  });

  it("refuses to extrapolate a ceiling from nothing", () => {
    const s = computeTelematicsCoverage([fill("2026-06-01T00:00:00Z", "pending")]);
    expect(s.attainablePct).toBeNull(); // a guess dressed as a measurement is worse than a blank
    expect(s.coveragePct).toBe(0);
  });

  it("does not silently bin a fill it cannot place in a month", () => {
    const s = computeTelematicsCoverage([
      fill(null, "reconciled"),
      fill("not-a-date", "reconciled"),
      fill("2026-08-01T00:00:00Z", "reconciled"),
    ]);
    expect(s.fills).toBe(1); // the two unplaceable rows are excluded from BOTH numerator and denominator
    expect(s.byMonth).toHaveLength(1);
  });

  it("is empty, not divided by zero, when there are no fills at all", () => {
    expect(computeTelematicsCoverage([])).toEqual({
      fills: 0, reconciled: 0, noData: 0, pending: 0,
      coveragePct: 0, byMonth: [], attainablePct: null,
    });
  });

  it("puts a December fill in December — the UTC month boundary is not the local one", () => {
    // 2026-01-01T00:30Z is still 2025-12-31 in Central. This measures a COLLECTOR against the instant
    // Samsara serves history for, so the month is UTC and deliberately not the business date.
    const s = computeTelematicsCoverage([fill("2026-01-01T00:30:00Z", "reconciled")]);
    expect(s.byMonth[0]!.month).toBe("2026-01");
  });
});
