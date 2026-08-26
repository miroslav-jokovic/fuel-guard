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
    routes: [{ path: "/fuel-exceptions", component: { template: "<div/>" }, meta: { title: "Fuel Exceptions" } }],
  });
  await router.push(`/fuel-exceptions${query}`);
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
    expect(seen.totalsWindow).toEqual({ from: "2026-06-01", to: "2026-06-30" });
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
});
