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

  /**
   * The regression: `fuel_spend_lines` took no org and this file called it with the SERVICE ROLE, which
   * bypasses RLS. The document read every carrier in the database — a test org's 267 fills landed in a
   * real carrier's exception and discount sections, and its 10 mis-keyed rows were mistaken for a unit
   * bug in the derivation.
   *
   * `expectOrgScoped` cannot catch this: it filters `rpc:` calls out by construction, because an RPC's
   * scoping lives in its ARGUMENTS rather than in a chained `.eq()`. That exemption is exactly the gap
   * the leak went through, so the argument is asserted directly.
   */
  it("passes its org to every RPC, which no .eq() chain would show", async () => {
    const rec = seed();
    await render(rec);
    const lines = rec.rpcs().filter((r) => r.fn === "fuel_spend_lines");
    expect(lines.length).toBeGreaterThan(0);
    for (const call of lines) expect((call.args as Record<string, unknown>).p_org).toBe(ORG);
  });

  it("never asks for fills without naming an org, which would return every carrier", async () => {
    const rec = seed();
    await render(rec);
    for (const call of rec.rpcs()) {
      const args = (call.args ?? {}) as Record<string, unknown>;
      // A null or absent p_org falls back to auth_org_id(), which is null under the service role — the
      // function fails closed rather than leaking, but a caller relying on that is still a bug.
      if ("p_org" in args) expect(args.p_org).toBeTruthy();
    }
  });

  // ── the policy the document measures belongs to the org ─────────────────────────────────────
  // It used to be a constant, so a report headed "California" went to carriers who avoid Oregon. The
  // rendered glyphs cannot be asserted (pdfkit compresses its content streams), so what is pinned is
  // that the row is READ, and read scoped — `admin` is the service role and bypasses RLS, so the
  // `.eq("org_id", …)` is this query's only tenant boundary.
  it("reads the org's own fuel policy rather than assuming one", async () => {
    const rec = seed({ route_fuel_settings: { data: { avoid_states: ["OR"], avoid_brands: ["pride"], preferred_brands: ["loves"] } } });
    await render(rec);
    expect(rec.forTable("route_fuel_settings"), "the report never asked for the org's policy").not.toHaveLength(0);
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  it("still renders for an org that has never configured a policy", async () => {
    // `route_fuel_settings` absent → the analyzer's documented defaults, not a crash.
    const { pdf } = await render(seed());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
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

  /**
   * ── THE PAGINATION REGRESSION ─────────────────────────────────────────────────────────────────
   * pdfkit answers a write past the bottom margin by starting a new page and putting that write on it.
   * `rankedBars` positions its rows at coordinates it computes itself, so once the list crossed the
   * margin every remaining string got a page of its own: a seven-day report came out as six pages, of
   * which page 3 held the single string "Unit 111", page 4 held "$52" and page 5 held "1 fill, 107
   * gal". Six pages for two pages of content.
   *
   * The exception rankings are what walk off the page, so the fixture has to produce them: several
   * sites and several trucks with excess against the fleet baseline. Without lines there are no
   * exceptions, no rankings, and the bug is invisible — which is why it shipped.
   */
  describe("pagination", () => {
    const site = (i: number) => ["ONE9 #77", "Loves #301", "TA #55", "Pilot #442", "Cardlock 8821"][i % 5]!;
    const brand = (i: number) => ["one9", "loves", "ta", "pilot", null][i % 5];
    const fills = Array.from({ length: 60 }, (_, i) => ({
      tran_date: `2026-08-${String(10 + (i % 14)).padStart(2, "0")}`,
      brand: brand(i), state: i % 3 === 0 ? "CA" : "TX", site: site(i), city: "Somewhere",
      unit: `10${i % 7}`, driver: `Driver ${i % 7}`, tank: "tractor",
      gallons: 100 + (i % 40), net_amount: (100 + (i % 40)) * (3.5 + (i % 9) * 0.05),
      retail_amount: null, contract_amount: null, quote_stale_days: 0,
    }));

    const withFills = () =>
      createSupabaseRecorder({
        tables: {
          fuel_spend_days: [
            ...Array.from({ length: 7 }, (_, i) => day("2026-08-10", i)),
            ...Array.from({ length: 7 }, (_, i) => day("2026-08-17", i, { spend_tractor: 700 })),
          ],
          fuel_transactions: [],
          organizations: { data: { name: "Silvicom Inc" } },
        },
        rpc: { fuel_spend_lines: fills },
      });

    it("never spends a page on a fragment of a ranking", async () => {
      const { pages } = await renderFuelSpendReport(withFills().client, {
        orgId: ORG, from: "2026-08-10", to: "2026-08-23", grain: "day",
        generatedAt: "2026-08-25T05:00:00Z",
      });
      // Six before the fix, three of them holding one string each.
      expect(pages).toBeLessThanOrEqual(3);
    });

    /**
     * The other half: content coming to a bit over a page printed with the remainder stranded on a
     * final page 80% white. `renderFuelSpendReport` composes again with the gaps between blocks
     * reduced and keeps that only if it drops the page count, so this asserts the OUTCOME — a page
     * count no worse than the roomy composition — rather than which pass produced it.
     */
    it("does not leave the tail of the document on a page of its own", async () => {
      const { pages } = await renderFuelSpendReport(withFills().client, {
        orgId: ORG, from: "2026-08-10", to: "2026-08-23", grain: "week",
        generatedAt: "2026-08-25T05:00:00Z",
      });
      expect(pages).toBeLessThanOrEqual(2);
    });

    it("still renders a document with no exceptions to rank at all", async () => {
      const { pdf, pages } = await render(seed());
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pages).toBeGreaterThan(0);
    });
  });

  it("falls back to a neutral carrier name rather than printing 'undefined' on a letterhead", async () => {
    const rec = seed({ organizations: { data: null } });
    expect((await render(rec)).carrier).toBe("Carrier");
  });
});
