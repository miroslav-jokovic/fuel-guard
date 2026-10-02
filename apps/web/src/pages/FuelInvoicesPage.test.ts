import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { ref, watch, type Ref } from "vue";

/**
 * Pilot invoices (FS3, D-FSV8). What only this page decides:
 *   • the list is the SERVER's pages — a page change asks for that page, and the count is the total;
 *   • a row opens its saved check;
 *   • a recorded upload lands on the check it recorded, never on a result held in the drawer;
 *   • "Check an invoice" is offered only to a caller who may upload (`manage`), while anyone who can
 *     see fuel reads the list.
 */

const run = (id: string, start: string, o: Record<string, unknown> = {}) => ({
  id, source_kind: "weekly_statement", source_filename: "db139445F.pdf", invoice_no: `inv-${id}`, period_start: start,
  period_end: start, tie_out_gated: true, tie_out_notes: [], matcher_version: "f4", unmatchable_lines: 0,
  created_at: "2026-09-14T20:14:18Z", superseded_by: null, superseded_at: null,
  summary: {
    reportLines: 431, systemFills: 433, clean: 425, dateDrift: 3, amountMismatch: 0, gallonMismatch: 0, amountUnknown: 0,
    cardDrift: 0, missingInSystem: 0, missingOnReport: 3, other: 0, matchedOnCard6: 428, matchedOnCard4: 0, matchedOnDateGallons: 0,
    exposure: { overbilled: 0, overbilledLines: 0, underbilled: 0, underbilledLines: 0, unbilled: 1284.51, unbilledLines: 3, unrecorded: 0, unrecordedLines: 0 },
  },
  ...o,
});

const asked: number[] = [];
vi.mock("@/features/reconcile/useReconRuns", () => ({
  useReconRunsQuery: (page: Ref<number>, size: number) => {
    const data = ref<unknown>(null);
    const load = () => {
      asked.push(page.value);
      data.value = { total: 61, runs: [run(`r${page.value}`, "2026-09-07"), run("rx", "2026-08-24", {
        source_kind: "monthly_export", invoice_no: null,
        summary: { ...run("x", "x").summary, missingInSystem: 2, exposure: { ...run("x", "x").summary.exposure, unrecorded: 242.11, unrecordedLines: 2 } },
      })] };
    };
    load();
    // Re-fetch on a page change, as vue-query does for a key that holds the ref.
    watch(page, load);
    void size;
    return { data, isLoading: ref(false), isFetching: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn() };
  },
}));
const canManage = vi.hoisted(() => ({ value: true }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => canManage.value }) }));
vi.mock("@/features/reconcile/CheckInvoiceDrawer.vue", () => ({
  default: { name: "CheckInvoiceDrawer", props: ["open"], emits: ["recorded", "close"], template: "<div />" },
}));

import FuelInvoicesPage from "./FuelInvoicesPage.vue";

let router: Router;
async function mountPage() {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/fuel-invoices", name: "fuel-invoices", component: { template: "<div/>" }, meta: { title: "Pilot invoices" } },
      { path: "/fuel-invoices/:id", name: "fuel-invoice-check", component: { template: "<div/>" } },
    ],
  });
  await router.push("/fuel-invoices");
  await router.isReady();
  const w = mount(FuelInvoicesPage, { global: { plugins: [router, createPinia()] } });
  await flushPromises();
  return w;
}

beforeEach(() => {
  setActivePinia(createPinia());
  asked.length = 0;
  canManage.value = true;
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: true, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

describe("FuelInvoicesPage", () => {
  it("lists the checks with the week, the source and each kind of finding, in plain words", async () => {
    const t = (await mountPage()).text();
    expect(t).toContain("09/07/2026 – 09/07/2026");
    expect(t).toContain("Invoice inv-r1");
    expect(t).toContain("Monthly export");
    expect(t).toContain("428 of 431"); // matched (clean + a day apart) of the bill's lines
    expect(t).toContain("In our records, not on Pilot's bill");
    expect(t).toContain("3 · $1,285");
    expect(t).toContain("2 · $242");
    expect(t).not.toContain("2026-09-07");
  });

  it("counts every check the server holds, not the page it was sent", async () => {
    expect((await mountPage()).text()).toMatch(/61\s+checks/);
  });

  it("asks the server for the next page rather than slicing what it has", async () => {
    const w = await mountPage();
    const next = w.findAll("button").find((b) => /next/i.test(b.attributes("aria-label") ?? b.text()));
    expect(next, "no next-page control").toBeTruthy();
    await next!.trigger("click");
    await flushPromises();
    expect(asked).toContain(2);
  });

  it("opens a check from its row", async () => {
    const w = await mountPage();
    await w.find("tbody tr").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/fuel-invoices/r1");
  });

  it("lands on the check an upload recorded", async () => {
    const w = await mountPage();
    await w.findAll("button").find((b) => b.text().includes("Check an invoice"))!.trigger("click");
    expect(w.findComponent({ name: "CheckInvoiceDrawer" }).props("open")).toBe(true);
    w.findComponent({ name: "CheckInvoiceDrawer" }).vm.$emit("recorded", "run-new");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/fuel-invoices/run-new");
    expect(w.findComponent({ name: "CheckInvoiceDrawer" }).props("open")).toBe(false);
  });

  it("offers the upload only to a caller who may make one", async () => {
    const has = (w: Awaited<ReturnType<typeof mountPage>>) => w.findAll("button").some((b) => b.text().includes("Check an invoice"));
    expect(has(await mountPage())).toBe(true);
    canManage.value = false;
    const reader = await mountPage();
    expect(has(reader)).toBe(false);
    expect(reader.text()).toContain("Invoice inv-r1"); // still reads the list
  });
});
