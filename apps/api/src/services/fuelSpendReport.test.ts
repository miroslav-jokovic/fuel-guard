import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { renderFuelSpendReport } from "./fuelSpendReport.js";

/**
 * The report as a document. Its arithmetic is the page's arithmetic — `spendSeries`,
 * `operatingBridge` and `analyzePolicyExceptions` are tested in `packages/shared` — so what is only
 * testable here is everything that made the FIRST render wrong:
 *
 *   • it compared against a period still filling, and announced spend down 88%;
 *   • it stamped footers past the bottom margin, so two pages of content came out as six;
 *   • it read whatever org it was handed without scoping the queries to it.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** One truck-day. Spread across trucks so `activeTrucks` is real rather than 1. */
const day = (d: string, i: number, o: Partial<Record<string, unknown>> = {}) => ({
  day: d, vehicle_id: `v${i}`, fills: 1,
  gallons_tractor: 100, gallons_reefer: 0, gallons_def: 0,
  spend_tractor: 500, spend_reefer: 0, spend_def: 0,
  miles: 750, mpg_gallons: 100, miles_rejected: 0,
  drive_sec: 28800, idle_sec: 28800, off_sec: 0, coverage_sec: 86400,
  ...o,
});

/** Two complete weeks plus a one-day stub of a third — the shape that broke the first render. */
function seed(extra: Record<string, unknown> = {}): SupabaseRecorder {
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => day("2026-08-10", i)),
    ...Array.from({ length: 5 }, (_, i) => day("2026-08-17", i, { spend_tractor: 600 })),
    day("2026-08-24", 0), // the week that has barely started
  ];
  return createSupabaseRecorder({
    tables: {
      fuel_spend_days: rows,
      fuel_transactions: [],
      organizations: { data: { name: "Silvicom Inc" } },
      ...extra,
    },
  });
}

const render = (rec: SupabaseRecorder, grain: "day" | "week" | "month" = "week") =>
  renderFuelSpendReport(rec.client, {
    orgId: ORG, from: "2026-08-10", to: "2026-08-24", grain, generatedAt: "2026-08-25T05:00:00Z",
  });

describe("renderFuelSpendReport", () => {
  it("scopes every tenant query to one organization", async () => {
    const rec = seed();
    await render(rec);
    expectOrgScoped(rec, ORG, {
      // The carrier name is looked up by primary key, whose ownership the auth layer already settled.
      exempt: ["organizations"],
    });
  });

  it("produces a PDF, and names the carrier on it", async () => {
    const rec = seed();
    const { pdf, carrier } = await render(rec);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
    expect(carrier).toBe("Silvicom Inc");
  });

  it("does not run to more pages than it has content for", async () => {
    // The footer stamp used to write past the bottom margin, so pdfkit added a page, stamped that one,
    // and added another: two pages of content rendered as six.
    const { pdf } = await render(seed());
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeLessThanOrEqual(3);
    expect(pages).toBeGreaterThan(0);
  });

  it("reports the period it was asked for, and counts every bucket in it", async () => {
    const { periods } = await render(seed());
    expect(periods).toBe(3); // two complete weeks plus the one that has started
  });

  it("renders at day and month grain too", async () => {
    for (const grain of ["day", "month"] as const) {
      const { pdf } = await render(seed(), grain);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    }
  });

  it("still renders when there is nothing to report, rather than throwing at a boss", async () => {
    const rec = createSupabaseRecorder({
      tables: { fuel_spend_days: [], fuel_transactions: [], organizations: { data: { name: "Empty Co" } } },
    });
    const { pdf, periods } = await render(rec);
    expect(periods).toBe(0);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("falls back to a neutral carrier name rather than printing 'undefined' on a letterhead", async () => {
    const rec = seed({ organizations: { data: null } });
    expect((await render(rec)).carrier).toBe("Carrier");
  });
});
