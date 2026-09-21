import { describe, expect, it } from "vitest";
import { IDLE_COST_BASIS_DEFAULTS } from "@silvicom/shared";
import { dashboardPath, unwrapDashboardResponse } from "./useDashboard";
import { IDLE_COST_BASIS_PENDING } from "@/composables/useIdleCostBasis";

/**
 * Queue item 5 step 4 — the Dashboard's ten reads became one call.
 *
 * What this file used to test (`allTimeCoverage`, the null-not-zero rule for the coverage tile)
 * moved to `packages/shared/src/samsara/allTimeCoverage.test.ts` with the rule itself, because the
 * API now applies it. What is left here is what the BROWSER still decides: which window it asks
 * for, and what it does with an answer it did not get.
 */
const SUMMARY = {
  totalSpend: 128_400.5,
  totalGallons: 34_100,
  openAnomalies: 7,
  spendTrend: [],
  anomaliesBySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
  topVehiclesByRisk: [],
  topDriversByRisk: [],
  idleCostUsd: 8_210.55,
  idleHours: 412,
  reeferSpend: 9_100,
  movingSpend: 111_000,
  coveragePct: 95,
  allTimeCoveragePct: 23,
  declinedCount: 3,
};

describe("dashboardPath", () => {
  /**
   * ⚠ Two calendar DAYS, in the order the picker gives them. The API refuses anything else with a
   * 400 rather than coercing it, and both mistakes this pins — an instant, or swapped bounds — are
   * otherwise silent: the page would render a plausible set of numbers for a window nobody asked
   * for. That is D-PREC5 in one line.
   */
  it("asks for the picked days, in order, and nothing else", () => {
    expect(dashboardPath({ from: "2026-09-01", to: "2026-09-30" })).toBe(
      "/api/dashboard?from=2026-09-01&to=2026-09-30",
    );
  });
});

describe("unwrapDashboardResponse", () => {
  it("returns the summary the widgets bind to", () => {
    expect(unwrapDashboardResponse({ ok: true, status: 200, data: { ok: true, data: SUMMARY } })).toEqual(SUMMARY);
  });

  // A refusal must reach vue-query as an ERROR, so the page shows its error state. Returning an
  // empty summary instead would draw a fleet that spent nothing and idled for no hours — a picture
  // of a healthy carrier, made out of a failed request.
  it("turns the API's own refusal into a query error, with its sentence", () => {
    expect(() =>
      unwrapDashboardResponse({ ok: true, status: 200, data: { ok: false, error: { message: "Dashboard unavailable" } } }),
    ).toThrow("Dashboard unavailable");
  });

  it("turns a transport failure into an error too", () => {
    expect(() =>
      unwrapDashboardResponse({ ok: false, status: 500, error: { code: "error", message: "Internal Server Error" } }),
    ).toThrow("Internal Server Error");
  });
});

/**
 * The basis the idle tiles multiply by before the request lands. It is the documented default and
 * never `undefined` — three surfaces multiply by it, and `undefined` renders as `$NaN`.
 */
describe("IDLE_COST_BASIS_PENDING", () => {
  it("is the documented default, derived rather than retyped", () => {
    expect(IDLE_COST_BASIS_PENDING).toEqual({ ...IDLE_COST_BASIS_DEFAULTS, priceSource: "default" });
  });
});
