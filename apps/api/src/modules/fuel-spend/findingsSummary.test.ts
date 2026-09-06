import { describe, it, expect } from "vitest";
import { readFindingsSummary, quarterStart } from "./findingsRead.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";

/**
 * The Dashboard's two ledger figures (C9), and every assertion is about WHO sees WHAT.
 *
 * This is the strip that made C9's ledger half wait for a ruling: the Dashboard carries
 * `requiresAuth` and no section gate, so any authenticated member opens it, a driver included. The
 * 2026-09-06 ruling put the inbox's own per-row derivation behind it instead of introducing a gate on
 * a page that has none — the shape Q-SAM7 chose for the Samsara strips.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-09-06T12:00:00Z");

/** Answers by the table AND the filters, so a count cannot be satisfied by the wrong query. */
const seed = (o: { anomalies?: number; exceptions?: number; credited?: unknown[] } = {}) =>
  createSupabaseRecorder({
    tables: {
      anomalies: { count: o.anomalies ?? 82, data: [] },
      fuel_exceptions: (q: RecordedQuery) =>
        q.filters().some((f) => f.col === "status" && f.val === "credited")
          ? { data: o.credited ?? [] }
          : { count: o.exceptions ?? 76, data: [] },
    },
  });

describe("the Dashboard's findings figures", () => {
  it("counts both sources for somebody who works both, and stays org-scoped", async () => {
    const rec = seed();
    const s = await readFindingsSummary(rec.client, ORG, "admin", NOW);
    expect(s.open).toBe(158);
    expectOrgScoped(rec, ORG);
  });

  // The accountant is the money role and deliberately only the money role (D-SEP7). A theft case is
  // not theirs to see, so it is not theirs to be counted either.
  it("counts only money findings for the bookkeeper, and never reads the anomaly table", async () => {
    const rec = seed();
    const s = await readFindingsSummary(rec.client, ORG, "accountant", NOW);
    expect(s.open).toBe(76);
    expect(rec.forTable("anomalies")).toHaveLength(0);
  });

  /**
   * ⚠ The ruling in one assertion. A driver opens this page — it has no section gate — and must be
   * told NOTHING rather than told zero. "No findings you may see" and "no findings" are different
   * facts about the fleet, and a tile reading 0 would state the second.
   */
  it("answers a driver null rather than zero, which are different facts", async () => {
    const rec = seed();
    const s = await readFindingsSummary(rec.client, ORG, "driver", NOW);
    expect(s.open).toBeNull();
    expect(s.recoveredThisQuarter).toBeNull();
    expect(rec.writes()).toHaveLength(0);
    expect(rec.forTable("anomalies")).toHaveLength(0);
    expect(rec.forTable("fuel_exceptions")).toHaveLength(0);
  });

  // D-FUI7: an anomaly closes with a disposition and never with money, so `recovered` can only come
  // from the ledger — and `fuel` is the only section that could gate it.
  it("gives the money figure only to somebody who can see the ledger", async () => {
    const credited = [{ credited_amount: "900.00" }, { credited_amount: 261.55 }];
    expect((await readFindingsSummary(seed({ credited }).client, ORG, "accountant", NOW)).recoveredThisQuarter).toBe(1161.55);
    // `safety_manager` holds `fuel: "view"`, so they do see it; a role with safety and no fuel would
    // not — there is none today, which is why this asserts the derivation rather than a role list.
    expect((await readFindingsSummary(seed({ credited }).client, ORG, "safety_manager", NOW)).recoveredThisQuarter).toBe(1161.55);
  });

  it("reads zero recovered as zero, not as unknown", async () => {
    const s = await readFindingsSummary(seed({ credited: [] }).client, ORG, "admin", NOW);
    expect(s.recoveredThisQuarter).toBe(0);
  });

  // Bounded by quarter AND by being credited — which is what keeps this off Q-SAM8's list of reads
  // whose cost grows with history.
  it("asks only for credited findings inside the current quarter", async () => {
    const rec = seed();
    await readFindingsSummary(rec.client, ORG, "admin", NOW);
    const moneyQuery = rec.forTable("fuel_exceptions").find((q) =>
      q.filters().some((f) => f.col === "status" && f.val === "credited"),
    )!;
    expect(moneyQuery.filters()).toEqual(
      expect.arrayContaining([{ col: "credited_on", val: "2026-07-01" }]),
    );
  });
});

describe("which quarter the figure covers", () => {
  // In UTC, like every stored date, so a January the 1st in a western timezone cannot report Q4.
  it("starts the quarter on the first of its first month", () => {
    expect(quarterStart(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
    expect(quarterStart(new Date("2026-03-31T23:59:59Z"))).toBe("2026-01-01");
    expect(quarterStart(new Date("2026-04-01T00:00:00Z"))).toBe("2026-04-01");
    expect(quarterStart(new Date("2026-09-06T12:00:00Z"))).toBe("2026-07-01");
    expect(quarterStart(new Date("2026-12-31T23:00:00Z"))).toBe("2026-10-01");
  });
});
