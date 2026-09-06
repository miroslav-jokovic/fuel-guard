import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref } from "vue";

/**
 * The ledger, mounted.
 *
 * The lifecycle RULES are proven in the PGlite matrix and the service tests; what is only testable
 * here is that a reader can see the three figures that matter, that the list and the header cover the
 * SAME window, and that a status never reaches the screen as its machine token.
 */

const listed = { value: [] as Record<string, unknown>[], total: 0 };
const seen = { listQuery: null as Record<string, unknown> | null, totalsWindow: null as Record<string, unknown> | null };

const asQuery = <T,>(get: () => T) => ({
  data: computed(get), isLoading: ref(false), isError: ref(false), error: ref(null),
});

vi.mock("@/features/reconcile/useExceptions", () => ({
  useExceptionsQuery: (q: { value: Record<string, unknown> }) => {
    seen.listQuery = q.value;
    return asQuery(() => ({ rows: listed.value, total: listed.total }));
  },
  useExceptionTotalsQuery: (w: { value: Record<string, unknown> }) => {
    seen.totalsWindow = w.value;
    return asQuery(() => ({ identified: 1942.11, claimed: 800, recovered: 275, lines: 4, openLines: 2, byKind: {} }));
  },
  useExceptionQuery: () => asQuery(() => null),
  useMoveException: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
  // The export's address is built from the LIST's own query builder (FUEL-P3), so the stub keeps that
  // property rather than inventing a second encoding: a mock that spelled the parameters its own way
  // could not fail when the page and the file stopped agreeing.
  exceptionExportQuery: (q: Record<string, unknown>) => {
    const p = new URLSearchParams({ from: String(q.from), to: String(q.to) });
    if ((q.status as string[])?.length) p.set("status", (q.status as string[]).join(","));
    if ((q.vehicleIds as string[])?.length) p.set("vehicles", (q.vehicleIds as string[]).join(","));
    if (q.assignedTo) p.set("assignedTo", String(q.assignedTo));
    return p.toString();
  },
}));
// The truck menu is the fleet. Stubbed rather than answered with a query client: this suite is about
// what the ledger asks for, and a live roster query would make it depend on a network stub instead.
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({
    data: ref([
      { id: "v-701", unit_number: "701", status: "active" },
      { id: "v-702", unit_number: "702", status: "active" },
    ]),
  }),
}));

import FuelExceptionsPage from "./FuelExceptionsPage.vue";

const row = (o: Record<string, unknown> = {}) => ({
  id: "e1", kind: "recon_missing_in_system", run_id: null, transaction_id: null,
  occurred_on: "2026-08-17", amount: 242.11, amount_kind: "unrecorded",
  unit_number: "701", site_number: "436", city: "Amarillo", state: "TX",
  evidence: {}, fingerprint: "fp", status: "open", assigned_to: null, resolved_by: null,
  resolved_at: null, resolution_note: null, credited_amount: null, credited_on: null,
  first_seen_at: "2026-08-25T00:00:00Z", last_seen_at: "2026-08-25T00:00:00Z", ...o,
});

beforeEach(() => {
  listed.value = [row()];
  listed.total = 1;
  seen.listQuery = null;
  seen.totalsWindow = null;
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (q: string) => ({
      matches: true, media: q, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

async function mountPage(query = "") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/fuel-spend/exceptions", component: { template: "<div/>" }, meta: { title: "Fuel Exceptions" } }],
  });
  await router.push(`/fuel-spend/exceptions${query}`);
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(FuelExceptionsPage, { global: { plugins: [router, pinia] } });
  await flushPromises();
  return { w, router };
}

describe("FuelExceptionsPage", () => {
  it("leads with identified, claimed and recovered — three numbers, never one", async () => {
    // "We found $14,200" is a claim about the software; "we recovered $14,200" is a claim about the
    // business, and only the second one renews a contract. The gap between them is the point.
    const t = (await mountPage()).w.text();
    expect(t).toContain("Identified");
    expect(t).toContain("Claimed");
    expect(t).toContain("Recovered");
    expect(t).toContain("$1,942");
    expect(t).toContain("$275");
    expect(t).not.toContain("NaN");
  });

  it("renders a finding in words, never as its token", async () => {
    const t = (await mountPage()).w.text();
    expect(t).toContain("Billed, never recorded");
    expect(t).toContain("Open");
    expect(t).not.toContain("recon_missing_in_system");
    expect(t).not.toContain("amount_kind");
  });

  it("opens on what still needs somebody, not on everything ever settled", async () => {
    await mountPage();
    expect(seen.listQuery?.status).toEqual(["open", "investigating", "disputed"]);
  });

  it("asks the list and the header for the SAME window", async () => {
    // The two disagreeing is how a header says $14,200 recovered over a period the table below is not
    // showing. `useSpendFilters` owns the window for exactly this reason.
    await mountPage("?from=2026-06-01&to=2026-06-30");
    expect(seen.listQuery).toMatchObject({ from: "2026-06-01", to: "2026-06-30" });
    expect(seen.totalsWindow).toMatchObject({ from: "2026-06-01", to: "2026-06-30" });
  });

  /* ── FUEL-P3 · A3 closed at both ends ─────────────────────────────────────────────────────── */

  /**
   * ⚠ The defect this step exists for. `?trucks=` was written by the filter bar, preserved in the URL
   * and read by NOTHING: `ExceptionQuery` had no vehicle field, `qs()` never sent one, and the API had
   * no parameter. A filter that is accepted, preserved and ignored is worse than one that is absent —
   * the URL says the ledger is scoped and the ledger is not.
   */
  it("sends the trucks the URL names, instead of accepting them and ignoring them", async () => {
    await mountPage("?trucks=v-701,v-702");
    expect(seen.listQuery?.vehicleIds).toEqual(["v-701", "v-702"]);
  });

  /**
   * The tiles take the same scope as the rows. Otherwise "Identified $41,000" sits above eleven rows
   * worth $600 — the disagreement FUEL-T3a spent a migration removing on the Fuel Log, arriving here
   * through a filter.
   */
  it("gives the four tiles the same truck scope as the list", async () => {
    await mountPage("?trucks=v-701");
    expect(seen.totalsWindow?.vehicleIds).toEqual(["v-701"]);
  });

  it("puts status and finding in the URL, so the view somebody forwards is the view they saw", async () => {
    await mountPage("?status=credited&kind=recon_amount");
    expect(seen.listQuery?.status).toEqual(["credited"]);
    expect(seen.listQuery?.kind).toEqual(["recon_amount"]);
  });

  it("ignores a status a finding cannot be in, rather than asking the database for it", async () => {
    await mountPage("?status=nonsense");
    expect(seen.listQuery?.status).toEqual(["open", "investigating", "disputed"]);
  });

  it("scopes to the caller's own queue when the URL says so, needing no member directory", async () => {
    // `/api/members` is admin-only, so an owner PICKER would work for one role and read as broken for
    // the accountant and the dispatcher who live in this ledger (Q-FUI4). "Mine" needs nobody's list.
    const { w } = await mountPage("?owner=me");
    expect(w.text()).toContain("Assigned to me");
    // The session is empty in this harness, so the id resolves to null — what matters is that the
    // page ASKS for the caller rather than for everybody.
    expect(seen.listQuery).toHaveProperty("assignedTo");
  });

  it("carries the whole filter into the export's address, not just the window", async () => {
    const { w } = await mountPage("?from=2026-06-01&to=2026-06-30&trucks=v-701&status=credited");
    const href = w.findAllComponents({ name: "ExportButton" })[0]?.props("href") as string;
    expect(href).toContain("/api/fueling/exceptions/export.csv?");
    expect(href).toContain("from=2026-06-01");
    expect(href).toContain("status=credited");
    expect(href).toContain("vehicles=v-701");
  });

  it("states the empty case as a fact and a next action", async () => {
    listed.value = [];
    listed.total = 0;
    const t = (await mountPage()).w.text();
    expect(t).toContain("Nothing outstanding in this window");
    expect(t).not.toContain("NaN");
  });

  it("offers no packet when there is nothing to claim", async () => {
    listed.value = [];
    listed.total = 0;
    const w = (await mountPage()).w;
    const packet = w.findAll("button").find((b) => b.text().includes("Dispute packet"));
    expect(packet?.attributes("disabled")).toBeDefined();
  });

  it("offers the packet and the CSV once there is", async () => {
    const w = (await mountPage()).w;
    expect(w.findAll("button").some((b) => b.text().includes("Dispute packet"))).toBe(true);
    expect(w.findAll("button").some((b) => b.text().includes("Export CSV"))).toBe(true);
  });

  it("disables the export when there is nothing to export", async () => {
    listed.value = [];
    listed.total = 0;
    const w = (await mountPage()).w;
    const csv = w.findAll("button").find((b) => b.text().includes("Export CSV"));
    expect(csv?.attributes("disabled")).toBeDefined();
  });
});
