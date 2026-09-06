import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref } from "vue";

/**
 * The Findings inbox, mounted (C7b — was the fuel exception ledger).
 *
 * The lifecycle RULES are proven in the PGlite matrix and the service tests, and the two-source merge
 * in `findingsRead.test.ts`. What is only testable here is that a reader can see the three figures
 * that matter, that the list and the header cover the SAME window, that a status never reaches the
 * screen as its machine token — and, since C7b, that the money tiles do not read as a total of a list
 * that now contains findings they deliberately do not count.
 */

const listed = { value: [] as Record<string, unknown>[], total: 0 };
const truncated = { value: false };
const seen = { listQuery: null as Record<string, unknown> | null, totalsWindow: null as Record<string, unknown> | null };

const asQuery = <T,>(get: () => T) => ({
  data: computed(get), isLoading: ref(false), isError: ref(false), error: ref(null),
});

vi.mock("@/features/reconcile/useFindings", () => ({
  useFindingsQuery: (q: { value: Record<string, unknown> }) => {
    seen.listQuery = q.value;
    return asQuery(() => ({ rows: listed.value, total: listed.total, truncated: truncated.value }));
  },
}));
vi.mock("@/features/reconcile/useExceptions", () => ({
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
/**
 * The assignment surface. Stubbed like every other composable here — the REFUSALS it exists for live
 * in `findingsAssign.test.ts` against the service, because they are the server's contract and a page
 * test that re-asserted them would be checking a stub. What is only testable here is which control
 * the page offers for a given selection.
 */
const assigned = { calls: [] as unknown[] };
vi.mock("@/features/reconcile/useFindingAssignment", async (orig) => ({
  ...(await orig<typeof import("@/features/reconcile/useFindingAssignment")>()),
  useAssigneesQuery: () => asQuery(() => [
    { id: "u-1", name: "Ana Ruiz", role: "admin" },
    { id: "u-2", name: null, role: "admin" },
  ]),
  useAssignFindings: () => ({
    mutateAsync: async (v: unknown) => { assigned.calls.push(v); return { assigned: 1 }; },
    isPending: ref(false),
  }),
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

/** A money finding, as the unified read returns it. */
const row = (o: Record<string, unknown> = {}) => ({
  id: "e1", source: "exception", kind: "recon_missing_in_system", section: "fuel",
  queueState: "open", occurredOn: "2026-08-17", unitNumber: "701",
  summary: "Billed, never recorded", amountUsd: 242.11, assignedTo: null,
  openedAt: "2026-08-25T00:00:00Z", close: null, ...o,
});

/** A theft case, which since C7b sits in the same queue and carries no money by construction. */
const theftRow = (o: Record<string, unknown> = {}) => ({
  id: "a1", source: "anomaly", kind: "theft_case", section: "safety",
  queueState: "open", occurredOn: "2026-08-18", unitNumber: null,
  summary: "Billed 179 gal into a 140 gal space", amountUsd: null, assignedTo: null,
  openedAt: "2026-08-18T00:00:00Z", close: null, ...o,
});

beforeEach(() => {
  listed.value = [row()];
  listed.total = 1;
  truncated.value = false;
  assigned.calls = [];
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
    routes: [
      { path: "/findings", component: { template: "<div/>" }, meta: { title: "Findings" } },
      { path: "/anomalies", component: { template: "<div/>" }, meta: { title: "Alerts" } },
    ],
  });
  await router.push(`/findings${query}`);
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(FuelExceptionsPage, { global: { plugins: [router, pinia] } });
  await flushPromises();
  return { w, router };
}

describe("the Findings inbox", () => {
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
    expect(seen.listQuery?.states).toEqual(["open", "investigating", "working"]);
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
    await mountPage("?state=closed&kind=recon_amount");
    expect(seen.listQuery?.states).toEqual(["closed"]);
    expect(seen.listQuery?.kinds).toEqual(["recon_amount"]);
  });

  it("ignores a state a finding cannot be in, rather than asking the database for it", async () => {
    await mountPage("?state=nonsense");
    expect(seen.listQuery?.states).toEqual(["open", "investigating", "working"]);
  });

  // ⚠ `?status=` was the LEDGER's vocabulary and `?state=` is the queue axis. A link sent last week
  // saying `?status=disputed` must fall back to the default queue rather than being reinterpreted:
  // `disputed` and `working` are different questions, and quietly answering the second when somebody
  // asked the first makes a forwarded link show something its sender never saw.
  it("does not reinterpret an old ledger status as a queue state", async () => {
    await mountPage("?status=disputed");
    expect(seen.listQuery?.states).toEqual(["open", "investigating", "working"]);
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
    const { w } = await mountPage("?from=2026-06-01&to=2026-06-30&trucks=v-701&state=closed");
    const href = w.findAllComponents({ name: "ExportButton" })[0]?.props("href") as string;
    expect(href).toContain("/api/fueling/exceptions/export.csv?");
    expect(href).toContain("from=2026-06-01");
    expect(href).toContain("vehicles=v-701");
    // ⚠ The queue state is translated into the LEDGER's own statuses on the way out, through C7a
    // rather than restated here. `closed` covers three of them, and a file built from the axis word
    // would have asked the export for a status the ledger has never heard of.
    expect(href).toContain("status=credited%2Cdismissed%2Cresolved_by_reingest");
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

  /* ── C7b · both sources, one queue ───────────────────────────────────────────────────────── */

  it("shows a theft case beside a money finding, each in words", async () => {
    listed.value = [row(), theftRow()];
    listed.total = 2;
    const t = (await mountPage()).w.text();
    expect(t).toContain("Billed, never recorded");
    expect(t).toContain("Possible theft");
    expect(t).toContain("Billed 179 gal into a 140 gal space");
    expect(t).not.toContain("theft_case");
  });

  /**
   * ⚠ The defect this page could most easily have shipped. The four tiles read `fuel_exceptions` and
   * that is CORRECT — D-FUI7 gives an anomaly no money, so a theft case has nothing to add. But the
   * list beneath them now holds theft cases, and "Identified $1,942 · 4 findings" above a list of
   * five rows reads as a total of what is on screen. It is not one, and the tiles say so.
   */
  it("says the money tiles count money findings only, now that the list holds more than those", async () => {
    listed.value = [row(), theftRow()];
    listed.total = 2;
    const t = (await mountPage()).w.text();
    expect(t).toContain("money findings");
  });

  // A zero in a money column is a figure, and one somebody would reasonably add to the column above.
  // ⚠ Asserted on the CELL rather than by the absence of "$0.00": `usd` formats with no decimals, so
  // a zero renders "$0" and a test looking for "$0.00" would pass against the very bug it names —
  // measured by mutating the page to `usd(r.amountUsd ?? 0)` and watching it stay green.
  it("gives a theft case a dash where its amount would be, never a zero", async () => {
    listed.value = [theftRow()];
    listed.total = 1;
    const { w } = await mountPage();
    const cells = w.findAll("tbody tr")[0]!.findAll("td");
    expect(cells[4]!.text()).toBe("—");
    expect(w.text()).not.toContain("$0");
  });

  // Aging is the accountability mechanism the Q-FUI4 ruling chose INSTEAD of a default assignee, so
  // it has to be on the screen for that ruling to mean anything.
  it("ages every finding, so an unclaimed one is visible without an owner", async () => {
    listed.value = [row({ openedAt: new Date(Date.now() - 5 * 86_400_000).toISOString() })];
    const t = (await mountPage()).w.text();
    expect(t).toContain("5d");
  });

  it("says so when the server could not fit the whole queue in one read", async () => {
    truncated.value = true;
    const t = (await mountPage()).w.text();
    expect(t).toContain("more findings than this page can hold");
  });

  // The two sources have different detail surfaces (D-FUI7's per-kind close affordance, one layer up).
  // A money finding opens the ledger drawer; a theft case has no detail ROUTE, so it hands the reader
  // to the page that can work it rather than opening an empty drawer or the wrong one.
  it("sends a theft case to the page that can work it, rather than the ledger drawer", async () => {
    listed.value = [theftRow()];
    listed.total = 1;
    const { w, router } = await mountPage();
    await w.findAll("tbody tr")[0]!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/anomalies");
    expect(router.currentRoute.value.query.case).toBe("a1");
  });

  // The packet is a document you send a vendor to bill money back. A theft case is an accusation
  // about a person and has no line in it, so it must not be counted into the button's availability.
  it("offers no dispute packet for a queue holding only theft cases", async () => {
    listed.value = [theftRow()];
    listed.total = 1;
    const { w } = await mountPage();
    const packet = w.findAll("button").find((b) => b.text().includes("Dispute packet"));
    expect(packet?.attributes("disabled")).toBeDefined();
  });

  /* ── C7b merge 3 · assignment ────────────────────────────────────────────────────────────── */

  const pick = async (w: ReturnType<typeof mount>, n = 0) => {
    await w.findAll("tbody tr")[n]!.findAll("input[type=checkbox]")[0]!.setValue(true);
    await flushPromises();
  };

  // Asserted on the picker rather than on the word "selected": DataTable's own header checkbox
  // carries select-all labelling, so the looser assertion passes whether the bar renders or not.
  it("offers no bulk control until something is selected", async () => {
    const { w } = await mountPage();
    expect(w.text()).not.toContain("Assign to");
    expect(w.text()).not.toContain("1 selected");
  });

  it("offers the people who could close it once a selection is made", async () => {
    const { w } = await mountPage();
    await pick(w);
    expect(w.text()).toContain("1 selected");
    expect(w.text()).toContain("Assign to");
  });

  /**
   * ⚠ A mixed selection offers NO picker. The two sections have different people who can close them,
   * and the API refuses an assignee who cannot close every finding in the batch — so a name offered
   * here would be a control that exists to produce an error message.
   */
  it("refuses to offer a picker for a selection spanning both sections", async () => {
    listed.value = [row(), theftRow()];
    listed.total = 2;
    const { w } = await mountPage();
    await pick(w, 0);
    await pick(w, 1);
    expect(w.text()).toContain("2 selected");
    expect(w.text()).not.toContain("Assign to");
    expect(w.text()).toContain("Narrow it to one kind");
  });

  /**
   * ⚠ A THEFT row on purpose. With only a money finding on screen the assertion passes against a page
   * that hard-codes `source: "exception"` — measured by mutating it and watching the test stay green.
   * The source is what tells the server which table to read a kind from, and getting it wrong is a
   * 404 rather than a wrong write, so it is worth a fixture that can tell the difference.
   */
  it("sends the source with every id, so the server need not guess which table it is", async () => {
    listed.value = [theftRow()];
    listed.total = 1;
    const { w } = await mountPage();
    await pick(w);
    const bar = w.findAllComponents({ name: "FilterSelect" }).at(-1)!;
    bar.vm.$emit("update:modelValue", "u-1");
    await flushPromises();
    expect(assigned.calls[0]).toEqual({ assignee: "u-1", findings: [{ source: "anomaly", id: "a1" }] });
  });

  // A selection that survived a narrowing would act on rows nobody can see any more.
  it("clears the selection when the filter changes", async () => {
    const { w, router } = await mountPage();
    await pick(w);
    expect(w.text()).toContain("1 selected");
    await router.push("/findings?state=closed");
    await flushPromises();
    expect(w.text()).not.toContain("1 selected");
  });

  // Assignment is the only bulk act. Bulk-closing a queue whose precision nobody has measured would
  // manufacture ground truth for the accuracy programme out of one careless click.
  it("offers no bulk close, dismiss or disposition", async () => {
    const { w } = await mountPage();
    await pick(w);
    const t = w.text();
    for (const word of ["Dismiss", "Close selected", "Mark as"]) expect(t).not.toContain(word);
  });
});
