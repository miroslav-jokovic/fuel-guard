import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";

/**
 * D-FIN14 at service grain: a swept month older than two months gets a close row computed from the
 * CPM tie-out and ledger coverage; a month whose sweep is not newer than its close is left alone
 * (a close is a fact about a moment); a hardened month whose ledger figures moved is reported to
 * the office once per day. The two heavy computations are mocked — they have their own suites.
 */
const ORG = "org1";
const NOW = new Date("2026-09-03T18:00:00Z");

const cpm = vi.fn();
const coverage = vi.fn();
vi.mock("./cpm.js", () => ({ computeCpmForWindow: (...a: unknown[]) => cpm(...a) }));
vi.mock("./ledgerCoverage.js", () => ({ getLedgerCoverage: (...a: unknown[]) => coverage(...a) }));
const notifyCalls: Array<Record<string, unknown>> = [];
vi.mock("../messaging/index.js", () => ({
  notify: vi.fn(async (_admin: unknown, input: Record<string, unknown>) => {
    notifyCalls.push(input);
    return "evt";
  }),
}));
import { runMonthClosesOnce } from "./monthClose.js";

const tiedReport = (glExpenses = 3000, residual = 0) => ({
  report: {
    glTieOut: {
      anchored: true,
      glExpenseTotal: glExpenses,
      attributedDirect: 1000,
      fixedCharged: 500,
      allocatedOverhead: 1400,
      unallocatedOverhead: 0,
      ownerOperatorSettlement: 100,
      fixedCostOnOwnerOperatorTrucks: 0,
      residual,
    },
  },
  provenance: { glCheck: { revenue: 5000, expenses: glExpenses } },
});
const tiedCoverage = (fuelDrift: number | null = 0) => ({
  modules: [
    { post_module: "SET", drift: 0 },
    { post_module: "BILL", drift: 0 },
    { post_module: "FUEL", drift: fuelDrift },
  ],
});

beforeEach(() => {
  cpm.mockReset();
  coverage.mockReset();
  notifyCalls.length = 0;
});

const recorder = (over: { closes?: Record<string, unknown>[]; totals?: Record<string, unknown>[] } = {}) =>
  createSupabaseRecorder({
    tables: {
      mcleod_gl_totals: over.totals ?? [
        { company_id: "TMS", period_start: "2026-06-01", period_end: "2026-07-01", swept_at: "2026-09-02T02:00:00Z" },
        { company_id: "TMS", period_start: "2026-06-01", period_end: "2026-07-01", swept_at: "2026-08-28T21:00:00Z" }, // an older stamp on another account row
        { company_id: "TMS", period_start: "2026-08-01", period_end: "2026-09-01", swept_at: "2026-09-02T02:00:00Z" },
      ],
      finance_month_closes: over.closes ?? [],
      org_integrations: [{ last_synced_at: "2026-09-02T02:05:00Z" }],
      memberships: [{ user_id: "u-owner" }],
    },
  });

describe("runMonthClosesOnce", () => {
  it("closes June as hardened and August as open (too young), from the newest sweep stamp per month", async () => {
    cpm.mockResolvedValue(tiedReport());
    coverage.mockResolvedValue(tiedCoverage());
    const rec = recorder();
    const rows = await runMonthClosesOnce(rec.client, testEnv(), ORG, NOW);
    expect(rows.map((r) => [r.period_start, r.status])).toEqual([
      ["2026-06-01", "hardened"],
      ["2026-08-01", "open"],
    ]);
    const june = rows[0]!;
    expect(june).toMatchObject({ company_id: "TMS", gl_expenses: 3000, attributed_direct: 1000, fixed_charged: 500, cpm_residual: 0, fuel_residual: 0, open_reasons: [] });
    expect(june.swept_at).toBe("2026-09-02T02:05:00Z"); // the financial sweep's own stamp
    expect(rows[1]!.open_reasons[0]).toContain("1 month(s) old");
    const written = rec.writtenRows("finance_month_closes");
    expect(written).toHaveLength(2);
    expect(notifyCalls).toHaveLength(0);
    expectOrgScoped(rec, ORG);
  });

  it("leaves a month alone when its sweep is not newer than its close — a close is a fact about a moment", async () => {
    cpm.mockResolvedValue(tiedReport());
    coverage.mockResolvedValue(tiedCoverage());
    const rec = recorder({
      closes: [
        { company_id: "TMS", period_start: "2026-06-01", swept_at: "2026-09-02T02:05:00Z", status: "hardened", gl_revenue: 5000, gl_expenses: 3000 },
      ],
    });
    const rows = await runMonthClosesOnce(rec.client, testEnv(), ORG, NOW);
    expect(rows.map((r) => r.period_start)).toEqual(["2026-08-01"]);
    expect(cpm).toHaveBeenCalledTimes(1);
  });

  it("a hardened month whose ledger moved on a later sweep is recomputed, reopened, and reported once", async () => {
    cpm.mockResolvedValue(tiedReport(3100, -12.5));
    coverage.mockResolvedValue(tiedCoverage(null));
    const rec = recorder({
      closes: [
        { company_id: "TMS", period_start: "2026-06-01", swept_at: "2026-08-28T21:00:00Z", status: "hardened", gl_revenue: 5000, gl_expenses: 3000 },
      ],
    });
    const rows = await runMonthClosesOnce(rec.client, testEnv(), ORG, NOW);
    const june = rows.find((r) => r.period_start === "2026-06-01")!;
    expect(june.status).toBe("open");
    expect(june.open_reasons).toEqual(["CPM buckets miss the ledger by $12.50", "fuel (FUEL): no sweep behind this module yet"]);
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0]).toMatchObject({
      userId: "u-owner",
      severity: "critical",
      dedupeKey: "finance:close-changed:org1:2026-09-03",
    });
    expect(String(notifyCalls[0]!.title)).toContain("2026-06 (TMS)");
  });
});
