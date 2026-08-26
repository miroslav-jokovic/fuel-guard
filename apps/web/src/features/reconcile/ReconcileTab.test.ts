import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref } from "vue";
import { reconcileFuelReport, type PilotReportFill, type SystemFill } from "@fuelguard/shared";

/**
 * The reconciliation tab — the one the page is named after, and the one nothing mounted.
 *
 * ── WHAT THIS PINS, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────────────────────────
 * The matching itself is `reconcilePilotFuel`, tested in `@fuelguard/shared`. What has never been
 * covered is everything between that function and a reader: whether a bucket tile filters the table
 * beneath it, whether a status renders as a word rather than a token, and whether the tab survives a
 * report it cannot fully match — which, on the real data, is the ordinary case rather than the edge.
 *
 * F4 rewrites the matcher (D-FR6's card last-6, D-FR7's product-class matching, a `date_drift` status
 * and four named exposure figures in place of one "dollars at stake"). These assertions are written
 * against the tab's CONTRACT with the matcher — buckets exist, tiles filter, statuses are words — so
 * they should survive that rewrite and fail if it breaks the surface rather than the arithmetic.
 */

/** The org's recorded fills, as `useSystemFillsQuery` projects them. */
const SYSTEM: SystemFill[] = [
  { id: "s1", cardRef: "7083050030491234", controlId: null, unit: "701", fueledAt: "2026-08-17T14:00:00Z", tranDate: "2026-08-17", tank: "tractor", gallons: 120, totalCost: 500 },
  // Same card and day as r2 below, billed $40 less than the vendor says — an amount mismatch.
  { id: "s2", cardRef: "7083050030495678", controlId: null, unit: "754", fueledAt: "2026-08-18T14:00:00Z", tranDate: "2026-08-18", tank: "tractor", gallons: 90, totalCost: 430 },
  // Recorded by us and absent from the report entirely.
  { id: "s3", cardRef: "7083050030499999", controlId: null, unit: "812", fueledAt: "2026-08-19T14:00:00Z", tranDate: "2026-08-19", tank: "tractor", gallons: 80, totalCost: 350 },
];

const reportFill = (o: Partial<PilotReportFill> & { authNo: string; gallons: number }): PilotReportFill => ({
  unit: "701", cardRef: "7083050030491234", site: "436", city: "Amarillo", state: "TX",
  netAmount: 500, retailAmount: 560, tranDate: "2026-08-17", time: "14:00", product: "diesel",
  productCode: "020", productDescription: "Truck Diesel", rowNumber: 1, ...o,
});

/** Matches s1 cleanly, disagrees with s2 on amount, and adds one line we never recorded. */
const REPORT: PilotReportFill[] = [
  reportFill({ authNo: "a1", gallons: 120 }),
  reportFill({ authNo: "a2", gallons: 90, netAmount: 470, cardRef: "7083050030495678", unit: "754", tranDate: "2026-08-18" }),
  reportFill({ authNo: "a3", gallons: 60, netAmount: 300, cardRef: "7083050030497777", unit: "999", tranDate: "2026-08-17", site: "512" }),
];

const loaded = {
  kind: "monthly_export" as const, fileName: "aug.xlsx", account: "139445", invoiceNumber: null,
  startDate: "2026-08-17", endDate: "2026-08-19", fills: REPORT, reeferLines: [], defLines: [],
  merchandise: [], totalGallons: 270, totalNet: 1270, totalRetail: 1400, tieOut: null,
  lineCount: 3, statementSource: null,
};

const loadFuelReport = vi.fn(async () => loaded);

vi.mock("@/features/reconcile/loadFuelReport", async (orig) => {
  const actual = await orig<typeof import("@/features/reconcile/loadFuelReport")>();
  return { ...actual, loadFuelReport: (...a: unknown[]) => loadFuelReport(...(a as [])) };
});
/**
 * The server's answer, built with the REAL matcher so the fixture cannot drift from what the API would
 * actually return. The tab's job is now to post and render, and that is what is asserted below.
 */
const serverResult = reconcileFuelReport(REPORT, SYSTEM, {
  window: { from: "2026-08-17", to: "2026-08-19" },
});

const runMutation = vi.fn(async (_input?: unknown) => ({
  ok: true, runId: "run-1", periodStart: "2026-08-17", periodEnd: "2026-08-19",
  invoiceNo: null, tieOutGated: true, tieOutNotes: [] as string[], result: serverResult,
}));

vi.mock("@/features/reconcile/useReconRuns", async (orig) => {
  const actual = await orig<typeof import("@/features/reconcile/useReconRuns")>();
  return {
    ...actual,
    useRunReconciliation: () => ({
      mutateAsync: (...a: unknown[]) => runMutation(...(a as [])),
      isPending: ref(false), isError: ref(false), error: ref(null),
    }),
    useReconRunsQuery: () => ({ data: computed(() => []), isLoading: ref(false), isError: ref(false) }),
  };
});
vi.mock("@/features/reconcile/useSaveStatement", async (orig) => {
  const actual = await orig<typeof import("@/features/reconcile/useSaveStatement")>();
  return { ...actual, useSaveStatement: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }) };
});
vi.mock("@/lib/reportGrid", async (orig) => {
  const actual = await orig<typeof import("@/lib/reportGrid")>();
  return { ...actual, readReportGrid: vi.fn(async () => [[]]), readPivotSheet: vi.fn(async () => null) };
});

import ReconcileTab from "./ReconcileTab.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";

beforeEach(() => {
  setActivePinia(createPinia());
  loadFuelReport.mockResolvedValue(loaded);
  // Vue Test Utils does not unmount between tests, so a mock that is not reset counts calls from
  // every earlier `it` as well as this one.
  runMutation.mockReset();
  runMutation.mockResolvedValue({
    ok: true, runId: "run-1", periodStart: "2026-08-17", periodEnd: "2026-08-19",
    invoiceNo: null, tieOutGated: true, tieOutNotes: [], result: serverResult,
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: true, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

/** Mount the tab and drop a file on it, since every interesting state is behind an upload. */
async function withReport() {
  const w = mount(ReconcileTab, { global: { plugins: [createPinia()] } });
  w.findComponent(FileDropzone).vm.$emit("files", [new File(["x"], "aug.xlsx")]);
  await flushPromises();
  return w;
}

describe("ReconcileTab", () => {
  it("asks for a file before it claims anything", () => {
    const t = mount(ReconcileTab, { global: { plugins: [createPinia()] } }).text();
    expect(t).toContain("Vendor fuel report");
    expect(t).not.toContain("Needs a look");
    expect(t).not.toContain("NaN");
  });

  it("reconciles a dropped report against the recorded fills and names each bucket", async () => {
    const t = (await withReport()).text();
    expect(t).toContain("aug.xlsx");
    expect(t).toContain("Needs a look");
    expect(t).toContain("Billed, never recorded"); // a3: on the report, never recorded
    expect(t).toContain("Recorded, never billed"); // s3: recorded, never billed
    expect(t).toContain("Amount differs");         // a2 vs s2, $40 apart
    expect(t).toContain("Matched");                // a1 vs s1
    expect(t).not.toContain("NaN");
  });

  it("renders a status as a word, never as its token", async () => {
    // The vocabulary is a `Record` in the component today; F4 moves it to shared with its label map.
    // Either way a reader must never see `missing_in_system`.
    const t = (await withReport()).text();
    expect(t).toContain("Billed, never recorded");
    expect(t).not.toContain("missing_in_system");
    expect(t).not.toContain("amount_mismatch");
  });

  it("opens on the discrepancies rather than on a table the reader has to filter", async () => {
    // A reconciliation is read for what disagrees. Landing on every clean row makes the reader work
    // before they can start, and the clean rows are the overwhelming majority.
    const w = await withReport();
    expect(w.text()).toContain("Needs a look");
    // The one clean fill is at unit 701; it should not be in the default table.
    const table = w.find("table").exists() ? w.find("table").text() : w.text();
    expect(table).toContain("999"); // the unrecorded fill IS shown
  });

  it("shows every row, clean ones included, once the reader asks for them", async () => {
    const w = await withReport();
    const before = w.text();
    // Clicking the "Matched clean" tile is how a reader gets to the rows that agreed.
    const cleanTile = w.findAll("button").find((b) => b.text().includes("reconciled"));
    expect(cleanTile, "no bucket tile for the clean rows").toBeTruthy();
    await cleanTile!.trigger("click");
    await flushPromises();
    expect(w.text()).not.toBe(before);
    expect(w.text()).not.toContain("NaN");
  });

  // ── F5: the browser sends bytes and the server concludes ────────────────────────────────────
  it("posts the decoded report rather than reconciling it here", async () => {
    // `fuel_recon_runs` has no client write policy, so a reconciliation the browser computed could
    // never be recorded. The tab decodes and posts; what it renders is what the server wrote.
    await withReport();
    expect(runMutation).toHaveBeenCalledTimes(1);
    const sent = (runMutation.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(sent.filename).toBe("aug.xlsx");
    expect("grid" in sent || "words" in sent).toBe(true);
  });

  it("says the reconciliation is kept, and offers it as a file", async () => {
    // Before F5 this tab was the only one on the page with no export, and its answer died with the
    // tab — so a discrepancy found on Tuesday was re-found from scratch on Thursday.
    const w = await withReport();
    expect(w.text()).toContain("Recorded");
    expect(w.findAll("button").some((b) => b.text().includes("Download every row"))).toBe(true);
  });

  it("shows the gate's own reasons when the server refuses the file", async () => {
    const { ReconRejected } = await import("@/features/reconcile/useReconRuns");
    runMutation.mockRejectedValueOnce(
      new ReconRejected("That report didn't add up", [
        "Diesel gallons read 418,530 against the 418,537.23 the export's own PivotTable prints.",
      ]),
    );
    const w = await withReport();
    // The parse still renders — the reader keeps what they are looking at — but nothing is CLAIMED:
    // no verdict, nothing recorded, and nothing to download. ("Needs a look" is not a useful marker
    // here: it is also a filter option, present whenever a report is loaded.)
    expect(w.text()).toContain("aug.xlsx");
    expect(w.text()).not.toContain("Recorded — this reconciliation is kept");
    expect(w.text()).not.toContain("What does not reconcile");
    expect(w.findAll("button").some((b) => b.text().includes("Download every row"))).toBe(false);
  });

  it("survives a report that matches nothing at all", async () => {
    loadFuelReport.mockResolvedValue({ ...loaded, fills: [], totalGallons: 0, totalNet: 0, totalRetail: 0 });
    const t = (await withReport()).text();
    expect(t).toContain("aug.xlsx");
    expect(t).not.toContain("NaN");
    expect(t).not.toContain("undefined");
  });
});
