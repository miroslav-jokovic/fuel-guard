import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { reconcileFuelReport, type PilotReportFill, type SystemFill } from "@silvicom/shared";

/**
 * "Check an invoice" — the upload (FS3, D-FSV8).
 *
 * The component decodes and posts; the server re-parses, matches and RECORDS. Since FS3 it renders no
 * result at all: it hands the recorded run's id to the page, which opens the saved check from the
 * server. What is pinned here is that hand-off, and that a refused file hands off nothing. What a
 * check LOOKS like is `ReconResultView.test.ts`'s.
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
  };
});
const saveStatement = vi.fn(async (_input?: unknown) => ({ ok: true, statementId: "stmt-1" }));
vi.mock("@/features/reconcile/useSaveStatement", async (orig) => {
  const actual = await orig<typeof import("@/features/reconcile/useSaveStatement")>();
  return { ...actual, useSaveStatement: () => ({ mutateAsync: (...a: unknown[]) => saveStatement(...(a as [])), isPending: ref(false) }) };
});
vi.mock("@/lib/reportGrid", async (orig) => {
  const actual = await orig<typeof import("@/lib/reportGrid")>();
  return { ...actual, readReportGrid: vi.fn(async () => [[]]), readPivotSheet: vi.fn(async () => null) };
});

import InvoiceUpload from "./InvoiceUpload.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useToastStore } from "@/stores/toast";

let pinia = createPinia();
beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  loadFuelReport.mockResolvedValue(loaded);
  // Vue Test Utils does not unmount between tests, so a mock that is not reset counts calls from
  // every earlier `it` as well as this one.
  runMutation.mockReset();
  runMutation.mockResolvedValue({
    ok: true, runId: "run-1", periodStart: "2026-08-17", periodEnd: "2026-08-19",
    invoiceNo: null, tieOutGated: true, tieOutNotes: [], result: serverResult,
  });
  saveStatement.mockReset();
  saveStatement.mockResolvedValue({ ok: true, statementId: "stmt-1" });
});

async function drop(name = "aug.xlsx") {
  const w = mount(InvoiceUpload, { global: { plugins: [pinia] } });
  w.findComponent(FileDropzone).vm.$emit("files", [new File(["x"], name)]);
  await flushPromises();
  return w;
}
const toastText = () => JSON.stringify(useToastStore().$state);

describe("InvoiceUpload", () => {
  it("hands the RECORDED run to the page, and nothing else", async () => {
    const w = await drop();
    expect(w.emitted("recorded")).toEqual([["run-1"]]);
    const sent = (runMutation.mock.calls[0] as unknown[])[0] as { filename: string; grid: unknown };
    expect(sent.filename).toBe("aug.xlsx");
    expect(sent.grid).toBeTruthy(); // an export travels as its grid
  });

  it("renders no result of its own — the saved check is the only copy anybody sees", async () => {
    const t = (await drop()).text();
    for (const word of ["Needs a look", "What does not reconcile", "Matched", "Download every"]) {
      expect(t, word).not.toContain(word);
    }
  });

  it("hands off nothing when the server refuses the file, and says why in the gate's words", async () => {
    const { ReconRejected } = await import("@/features/reconcile/useReconRuns");
    runMutation.mockRejectedValueOnce(
      new ReconRejected("That report didn't add up", ["Diesel gallons read 418,530 against the 418,537.23 its own PivotTable prints."]),
    );
    const w = await drop();
    expect(w.emitted("recorded")).toBeUndefined();
    expect(toastText()).toContain("418,537.23");
  });

  it("keeps a weekly statement, then points the check at it", async () => {
    loadFuelReport.mockResolvedValue({
      ...loaded, kind: "weekly_statement" as const, fileName: "db139445F.pdf", invoiceNumber: "800157197",
      statementSource: { words: [{ text: "x", x: 1, y: 1, page: 1 }], bytes: new ArrayBuffer(4) },
    } as never);
    const w = await drop("db139445F.pdf");
    expect(saveStatement).toHaveBeenCalledTimes(1);
    const sent = (runMutation.mock.calls[0] as unknown[])[0] as { statementId: string | null; words: unknown[] | null; grid: unknown };
    expect(sent.statementId).toBe("stmt-1");
    expect(sent.words).toHaveLength(1);
    expect(sent.grid).toBeNull();
    expect(w.emitted("recorded")).toEqual([["run-1"]]);
  });

  it("still checks the invoice when keeping the statement failed", async () => {
    loadFuelReport.mockResolvedValue({
      ...loaded, kind: "weekly_statement" as const, fileName: "db139445F.pdf", invoiceNumber: "800157197",
      statementSource: { words: [{ text: "x", x: 1, y: 1, page: 1 }], bytes: new ArrayBuffer(4) },
    } as never);
    saveStatement.mockRejectedValueOnce(new Error("storage down"));
    const w = await drop("db139445F.pdf");
    expect((runMutation.mock.calls[0] as unknown[])[0]).toMatchObject({ statementId: null });
    expect(w.emitted("recorded")).toEqual([["run-1"]]);
    expect(toastText()).toContain("Statement not saved");
  });

  it("says when the check was kept without its lines", async () => {
    runMutation.mockResolvedValueOnce({
      ok: true, runId: "run-1", periodStart: "2026-08-17", periodEnd: "2026-08-19", invoiceNo: null,
      tieOutGated: true, tieOutNotes: [], result: serverResult, linesError: "relation does not exist",
    } as never);
    await drop();
    expect(toastText()).toContain("saved without its lines");
  });
});
