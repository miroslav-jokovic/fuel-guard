import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import { ref, type Ref } from "vue";

/**
 * One saved invoice check (FS3). What only this page decides: it asks the server for the check the
 * URL names; it says when a later check of the same invoice replaced this one; and it tells "no such
 * check" apart from a failed load — a link from another carrier must not read as a network error.
 */

const RUN = {
  id: "r1", source_kind: "weekly_statement", source_filename: "db139445F.pdf", invoice_no: "799011888",
  period_start: "2026-09-07", period_end: "2026-09-13", tie_out_gated: true, tie_out_notes: [], matcher_version: "f4",
  unmatchable_lines: 306, created_at: "2026-09-14T20:14:18Z", superseded_by: null as string | null, superseded_at: null as string | null,
  summary: {
    reportLines: 431, systemFills: 433, clean: 428, dateDrift: 0, amountMismatch: 0, gallonMismatch: 0, amountUnknown: 0,
    cardDrift: 0, missingInSystem: 0, missingOnReport: 3, other: 0, matchedOnCard6: 428, matchedOnCard4: 0, matchedOnDateGallons: 0,
    exposure: { overbilled: 0, overbilledLines: 0, underbilled: 0, underbilledLines: 0, unbilled: 1284.51, unbilledLines: 3, unrecorded: 0, unrecordedLines: 0 },
  },
};

const answer = vi.hoisted(() => ({ value: undefined as unknown, error: false }));
const askedFor: string[] = [];
vi.mock("@/features/reconcile/useReconRuns", () => ({
  useReconRunQuery: (id: Ref<string>) => {
    askedFor.push(id.value);
    return { data: ref(answer.value), isLoading: ref(false), isError: ref(answer.error), error: ref(answer.error ? new Error("Could not load that invoice check") : null) };
  },
}));
vi.mock("@/features/reconcile/ReconResultView.vue", () => ({
  default: { name: "ReconResultView", props: ["summary", "rows", "exportName"], template: "<div>RESULT</div>" },
}));

import FuelInvoiceCheckPage from "./FuelInvoiceCheckPage.vue";

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/fuel-invoices/:id", component: { template: "<div/>" }, meta: { title: "Invoice check" } }],
  });
  await router.push(path);
  await router.isReady();
  const w = mount(FuelInvoiceCheckPage, { global: { plugins: [router, createPinia()] } });
  await flushPromises();
  return w;
}

beforeEach(() => {
  askedFor.length = 0;
  answer.error = false;
  answer.value = { run: RUN, lines: [], unmatchable: [] };
});

describe("FuelInvoiceCheckPage", () => {
  it("asks for the check the URL names and shows what it was checked against", async () => {
    const w = await mountAt("/fuel-invoices/r7");
    expect(askedFor).toEqual(["r7"]);
    const t = w.text();
    expect(t).toContain("Invoice 799011888 · 09/07/2026 – 09/13/2026");
    expect(t).toContain("431 lines on the bill");
    expect(t).toContain("306 DEF and in-store lines set aside");
    expect(t).toContain("Matches the totals Pilot printed");
    expect(t).not.toContain("checked again");
  });

  it("hands the recorded lines to the result, untouched — and null as null", async () => {
    answer.value = { run: RUN, lines: null, unmatchable: null };
    const view = (await mountAt("/fuel-invoices/r1")).findComponent({ name: "ReconResultView" });
    expect(view.props("rows")).toBeNull();
    expect(view.props("summary")).toEqual(RUN.summary);
  });

  it("says when a later check of the same invoice replaced this one", async () => {
    answer.value = { run: { ...RUN, superseded_by: "r2", superseded_at: "2026-10-02T17:00:00Z" }, lines: [], unmatchable: [] };
    const t = (await mountAt("/fuel-invoices/r1")).text();
    expect(t).toContain("checked again");
    expect(t).toContain("10/02/2026");
  });

  it("tells a check that isn't there apart from one that failed to load", async () => {
    answer.value = null;
    const missing = (await mountAt("/fuel-invoices/nope")).text();
    expect(missing).toContain("no invoice check with that link");
    expect(missing).not.toContain("Could not load");

    answer.value = undefined;
    answer.error = true;
    const failed = (await mountAt("/fuel-invoices/r1")).text();
    expect(failed).toContain("Could not load that invoice check");
    expect(failed).not.toContain("no invoice check with that link");
  });
});
