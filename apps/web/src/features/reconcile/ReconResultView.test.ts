import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reconcileFuelReport, type PilotReportFill, type SystemFill } from "@silvicom/shared";
import ReconResultView from "./ReconResultView.vue";

/**
 * A saved invoice check, as the Pilot invoices page shows it (FS3). The fixture is built with the REAL
 * matcher, so it cannot drift from what the API records. What is pinned is the surface: statuses are
 * words, tiles filter, the money is never summed, and a check whose lines were not kept says so rather
 * than showing an empty table under a count that says otherwise.
 */

const SYSTEM: SystemFill[] = [
  { id: "s1", cardRef: "491234", controlId: null, unit: "701", fueledAt: "2026-08-17T14:00:00Z", tranDate: "2026-08-17", tank: "tractor", gallons: 120, totalCost: 500 },
  { id: "s2", cardRef: "495678", controlId: null, unit: "754", fueledAt: "2026-08-18T14:00:00Z", tranDate: "2026-08-18", tank: "tractor", gallons: 90, totalCost: 430 },
  { id: "s3", cardRef: "499999", controlId: null, unit: "812", fueledAt: "2026-08-19T14:00:00Z", tranDate: "2026-08-19", tank: "tractor", gallons: 80, totalCost: 350 },
];
const fill = (o: Partial<PilotReportFill> & { authNo: string; gallons: number }): PilotReportFill => ({
  unit: "701", cardRef: "491234", site: "436", city: "Amarillo", state: "TX", netAmount: 500, retailAmount: 560,
  tranDate: "2026-08-17", time: "14:00", product: "diesel", productCode: "020", productDescription: "Truck Diesel",
  rowNumber: 1, ...o,
});
/** a1 matches s1; a2 is $40 above s2; a3 is on the bill and not ours; s3 is ours and not billed. */
const RESULT = reconcileFuelReport(
  [
    fill({ authNo: "a1", gallons: 120 }),
    fill({ authNo: "a2", gallons: 90, netAmount: 470, cardRef: "495678", unit: "754", tranDate: "2026-08-18" }),
    fill({ authNo: "a3", gallons: 60, netAmount: 300, cardRef: "497777", unit: "999", tranDate: "2026-08-17", site: "512" }),
  ],
  SYSTEM,
  { window: { from: "2026-08-17", to: "2026-08-19" } },
);

beforeEach(() => {
  // DataTable branches on matchMedia; jsdom has none.
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: true, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

const view = (rows = RESULT.rows) =>
  mount(ReconResultView, { props: { summary: RESULT.summary, rows, exportName: "pilot-test" } });
const tableText = (w: ReturnType<typeof view>) => w.find("table").text();

describe("ReconResultView", () => {
  it("names each kind of line in the plan's words, never as a token", () => {
    const t = view().text();
    expect(t).toContain("On Pilot's bill, not in our records");
    expect(t).toContain("In our records, not on Pilot's bill");
    expect(t).toContain("Amount differs");
    for (const token of ["missing_in_system", "missing_on_report", "amount_mismatch", "Billed, never recorded", "NaN"]) {
      expect(t, token).not.toContain(token);
    }
  });

  it("opens on what needs a look, not on the clean majority", () => {
    const t = tableText(view());
    expect(t).toContain("999"); // on the bill, not ours
    expect(t).toContain("812"); // ours, not billed
    expect(t).not.toContain("701"); // the clean match
  });

  it("shows the clean rows once the reader asks for them", async () => {
    const w = view();
    const clean = w.findAll("button").find((b) => b.text().includes("reconciled"));
    expect(clean, "no tile for clean rows").toBeTruthy();
    await clean!.trigger("click");
    await flushPromises();
    expect(tableText(w)).toContain("701");
    expect(tableText(w)).not.toContain("999");
  });

  it("reports the money apart and never adds it up", () => {
    // Read from the money card alone: the tiles above repeat two of these figures as hints, so a page
    // that lost the card would still "contain" them.
    const card = view().findAll("dl").find((d) => d.text().includes("Billed above what we recorded"));
    expect(card, "no money card").toBeTruthy();
    const t = card!.text();
    expect(t).toContain("$300"); // on the bill, not ours
    expect(t).toContain("$350"); // ours, not billed
    expect(t).toContain("$40"); // billed above what we recorded
    // $300 + $350 + $40 = $690: a total would be this, and must not exist.
    expect(t).not.toContain("$690");
  });

  it("is a toggle group with one pressed member, not a description list holding buttons", () => {
    const w = view();
    for (const dl of w.findAll("dl")) expect(dl.findAll("button")).toHaveLength(0);
    const pressed = w.findAll('[aria-pressed="true"]');
    expect(pressed).toHaveLength(1);
    expect(pressed[0]!.text()).toContain("Needs a look");
  });

  it("dates every line MM/DD/YYYY", () => {
    expect(tableText(view())).toContain("08/17/2026");
    expect(tableText(view())).not.toContain("2026-08-17");
  });

  it("says a check's lines were not kept, instead of an empty table under a non-zero count", () => {
    const w = view(null as never);
    expect(w.text()).toContain("lines weren't kept");
    expect(w.find("table").exists()).toBe(false);
    // The totals still show: they were recorded.
    expect(w.text()).toContain("On Pilot's bill, not in our records");
    expect(w.findAll("button").some((b) => b.text().includes("Download"))).toBe(false);
  });
});
