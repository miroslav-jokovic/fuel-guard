import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createMemoryHistory, createRouter } from "vue-router";

/**
 * F21 (US6b batch 3) — a record that does not exist is its own state on every detail page (D-US5).
 *
 * Measured 2026-10-13 against eight pages: five drew a blank body under their header, Vehicle drew
 * a truck with no data, Fuel card said "Loading the card…" for good, and Driver printed TanStack's
 * own message. A real 404 from the API meanwhile cost seven seconds of retries and then a Retry
 * button that could only fail again.
 *
 * Nothing about the read is mocked but the wire. Each page mounts with its real hooks, a real query
 * client on the app's own defaults (`QUERY_DEFAULTS`, which `main.ts` installs) and the app's real
 * route table, and the API answers every request with a 404. So this asks the whole chain: the hook
 * turns the 404 into `NotFoundError`, the client does not retry it, `QueryState` draws
 * `NotFoundState`, and that offers the way back to the list the route names as its `meta.parent`.
 */

const api = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    api.calls.push(path);
    return { ok: false, status: 404, error: { code: "not_found", message: "Not on file." } };
  }),
  apiDownload: vi.fn(),
  fetchObjectUrl: vi.fn(),
}));

/**
 * PostgREST, for the two pages that read it directly (Vehicle's row, Driver's fills): every chain
 * answers no rows, and `.maybeSingle()` answers `null` — PostgREST's own "there is no such row".
 */
vi.mock("@/lib/supabase", () => {
  const answer = { data: null, error: null, count: 0 };
  const chain: object = new Proxy(() => chain, {
    get: (_t, key) => (key === "then" ? (resolve: (v: unknown) => void) => resolve(answer) : () => chain),
    apply: () => chain,
  });
  return { supabase: { from: () => chain, rpc: () => chain }, DEV_BYPASS: false };
});
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  return { useSessionStore: () => ({ ...fakeSession("admin"), isAuthenticated: true }) };
});
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/features/anomalies/useDetectionEpoch", async () => {
  const { ref } = await import("vue");
  return { useDetectionEpoch: () => ({ epoch: ref(null), ready: ref(true) }), afterReset: (q: unknown) => q };
});

import { ROUTE_TABLE } from "@/router/table";
import { QUERY_DEFAULTS } from "@silvicom/ui";

const ID = "00000000-0000-4000-8000-000000000001";

/** Sections with reads and children of their own; each must be gone once the record is. */
const SECTIONS = [
  "QualificationSection",
  "SevenDayStatementSection",
  "DriverContactSection",
  "UnitKitCard",
  "UnitFileSection",
  "UnitWorkOrdersCard",
  "UnitInspectionsCard",
  "HiringChecklistCard",
  "DispositionSection",
];

async function mountAt(page: string, path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] });
  await router.push(path);
  await router.isReady();
  const Page = (await import(`./${page}.vue`)).default;
  const w = mount(Page, {
    global: {
      plugins: [router, [VueQueryPlugin, { queryClientConfig: { defaultOptions: QUERY_DEFAULTS } }]],
      stubs: { BaseChart: true, ...Object.fromEntries(SECTIONS.map((s) => [s, true])) },
    },
  });
  // Several ticks: a read, its rejection, and the render that follows each.
  for (let i = 0; i < 5; i++) await flushPromises();
  return w;
}

beforeEach(() => {
  setActivePinia(createPinia());
  api.calls.length = 0;
});

describe("a record that does not exist is its own state, with the way back to its list (F21)", () => {
  it.each([
    ["AssetDetailPage", `/shop/assets/${ID}`, "That asset is not on the books.", "Back to Equipment", `/assets/${ID}`],
    ["PartDetailPage", `/shop/inventory/${ID}`, "That part is not in the catalogue.", "Back to Parts", `/parts/${ID}`],
    ["UnitDetailPage", `/shop/units/tractor/${ID}`, "That truck or trailer is not on the fleet.", "Back to Trucks & trailers", `/units/tractor/${ID}`],
    ["AnnualInspectionFormPage", `/shop/inspections/${ID}`, "That inspection is not on file.", "Back to Annual inspections", `/inspections/${ID}`],
    ["FuelInvoiceCheckPage", `/fuel-invoices/${ID}`, "There's no invoice check with that link.", "Back to Pilot invoices", `/recon-runs/${ID}`],
    ["FuelCardDetailPage", `/fuel-cards/${ID}`, "That card is not in this company.", "Back to Fuel Cards", `/fuel-cards/${ID}`],
    ["DriverDetailPage", `/drivers/${ID}`, "That driver is not in this company.", "Back to Drivers", `/roster/drivers/${ID}`],
    // Found by the gate rule this finding added (`ui-adoption: not-a-record`), not by the browser pass.
    ["RoadsideInspectionPage", `/roadside-inspections/${ID}`, "That roadside inspection is not on file", "Back to Roadside inspections", `/roadside-inspections/${ID}`],
    ["HazmatLoadDetailPage", `/hazmat/loads/${ID}`, "That hazmat load is not on file.", "Back to Loads", `/hazmat/loads/${ID}`],
    ["DispatchLoadDetailPage", `/loads/${ID}`, "That load no longer exists.", "Back to Loads", `/dispatch/loads/${ID}`],
    ["CountSessionPage", `/shop/count/${ID}`, "That walk is not on file.", "Back to Shop", `/count-sessions/${ID}`],
  ])("%s", async (page, path, sentence, back, recordPath) => {
    const w = await mountAt(page, path);
    const state = w.find("[data-state=not-found]");
    expect(state.exists(), `${page} draws the not-found state`).toBe(true);
    expect(state.text()).toContain(sentence);
    expect(state.text()).toContain(back);
    expect(w.text(), page).not.toContain("Retry");
    expect(w.text(), page).not.toContain("Could not load");
    expect(w.text(), page).not.toMatch(/Loading/);
    // Asked once: a missing record is not retried.
    expect(api.calls.filter((p) => p.endsWith(recordPath)), page).toHaveLength(1);
    for (const s of SECTIONS) expect(w.findComponent({ name: s }).exists(), `${page} hides ${s}`).toBe(false);
    w.unmount();
  });

  it("ApplicantRecordPage — no row is not-found, not an applicant whose checklist could not load", async () => {
    const w = await mountAt("ApplicantRecordPage", `/recruitment/${ID}`);
    const state = w.find("[data-state=not-found]");
    expect(state.exists()).toBe(true);
    expect(state.text()).toContain("That applicant is not on file.");
    expect(state.text()).toContain("Back to Applicants");
    expect(w.text()).not.toContain("Retry");
    expect(w.findComponent({ name: "HiringChecklistCard" }).exists()).toBe(false);
    w.unmount();
  });

  it("TrailerDetailPage — no row is not-found, not a trailer with no file", async () => {
    const w = await mountAt("TrailerDetailPage", `/trailers/${ID}`);
    const state = w.find("[data-state=not-found]");
    expect(state.exists()).toBe(true);
    expect(state.text()).toContain("That trailer is not on the fleet.");
    expect(state.text()).toContain("Back to Trailers");
    expect(w.findComponent({ name: "UnitKitCard" }).exists()).toBe(false);
    expect(w.findComponent({ name: "UnitFileSection" }).exists()).toBe(false);
    w.unmount();
  });

  it("VehicleDetailPage — no row is not-found, not a truck with no data", async () => {
    const w = await mountAt("VehicleDetailPage", `/vehicles/${ID}`);
    const state = w.find("[data-state=not-found]");
    expect(state.exists()).toBe(true);
    expect(state.text()).toContain("That vehicle is not on the fleet.");
    expect(state.text()).toContain("Back to Vehicles");
    expect(w.text()).not.toContain("No fills yet.");
    expect(w.text()).not.toContain("No anomalies.");
    expect(w.findComponent({ name: "UnitKitCard" }).exists()).toBe(false);
    w.unmount();
  });
});
