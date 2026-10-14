import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { computed, ref } from "vue";
import type { DrugAlcoholProgram } from "@silvicom/shared";

/**
 * Safety › Drug & Alcohol, mounted (MEDSTOP-PLAN.md §7A, MS-UX1). Pinned: five tabs with the count of
 * the list each shows; Random selections opens first for the DER and is not drawn at all for a role the
 * API holds selections from; the tab lives in the URL; the medical tab shows both dates when they
 * differ; and a sweep that stopped reading is said out loud.
 */

const state = vi.hoisted(() => ({ program: null as unknown, role: null as string | null }));
// The order button reads the caller's role (UX3); null by default so the tabs' own tests are unchanged.
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ get role() { return state.role; } }) }));
vi.mock("@/components/medstop/OrderTestDrawer.vue", () => ({
  default: { props: ["open", "seed"], template: `<div v-if="open" data-test="order-drawer">{{ seed ? "seeded:" + seed.selectionId : "unseeded" }}</div>` },
}));
vi.mock("@/features/drugAlcohol/useDrugAlcoholProgram", () => ({
  useDrugAlcoholProgram: () => ({
    data: computed(() => state.program), isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn(),
  }),
}));

import DrugAlcoholPage from "./DrugAlcoholPage.vue";

const person = (id: string, name: string) => ({ driverId: id, medstopId: `m-${id}`, name });
// Unscanned card, sources disagree: the file keeps the earlier (Med-Stop's). A scanned card that
// McLeod disagrees with is flagged but not due.
const medDiff = {
  person: person("d2", "Med Diff"), expiresOn: "2026-11-10", daysLeft: 28, documented: false, disagree: true,
  sources: [{ source: "mcleod" as const, expiresOn: "2027-01-01" }, { source: "medstop" as const, expiresOn: "2026-11-10" }],
};
const scanned = {
  person: person("d6", "Scan Kept"), expiresOn: "2027-08-01", daysLeft: 292, documented: true, disagree: true,
  sources: [{ source: "mcleod" as const, expiresOn: "2026-12-31" }],
};

const program = (over: Partial<DrugAlcoholProgram> = {}): DrugAlcoholProgram => ({
  connected: true,
  syncedAt: new Date().toISOString(),
  lastError: null,
  pools: [{
    service: "drug", label: "Drug", poolYear: 2026, endsOn: "2026-12-31", frequency: "QUARTERLY", targetPercent: 53,
    currentPercent: 42.58, membersAvg: 155, completedTests: 66, requiredTests: 83, testsOwed: 17, scheduledTests: 17, lostSelections: 12,
  }],
  selections: {
    due: [{ selectionId: "s1", service: "drug", selectedOn: "2026-10-06", daysSince: 7, person: person("d9", "Dee Due"), ordered: false }],
    reserves: [],
  },
  inProgress: [
    { key: "test:t1", person: person("d5", "Pat Pending"), kind: "drug", reason: "PRE-EMPLOYMENT", stage: "At the lab", orderedOn: null, collectedOn: "2026-10-09", expectedOn: "2026-10-13", daysWaiting: 4 },
  ],
  results: { recent: [], history: [] },
  medical: {
    due: [medDiff],
    disagree: [medDiff, scanned],
  },
  roster: { notInPool: [person("d1", "Bob Outside")], leftButInPool: [] },
  ...over,
});

let router: Router;
async function render(p: DrugAlcoholProgram, path = "/drug-alcohol") {
  state.program = p;
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/drug-alcohol", component: { template: "<div/>" }, meta: { title: "Drug & Alcohol" } },
      { path: "/drivers/:id", name: "driver-detail", component: { template: "<div/>" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(DrugAlcoholPage, { global: { plugins: [router, pinia] } });
  await flushPromises();
  return w;
}
const tabLabels = (w: Awaited<ReturnType<typeof render>>) => w.findAll('[role="tab"]').map((t) => t.text().replace(/\s+/g, " ").trim());

describe("DrugAlcoholPage", () => {
  it("draws five tabs with their counts and opens on Random selections for the DER", async () => {
    const w = await render(program());
    expect(tabLabels(w)).toEqual(["Random selections 1", "In progress 1", "Results", "Medical cards 1", "Roster check 1"]);
    expect(w.text()).toContain("Dee Due");
    expect(w.text()).toContain("Not ordered");
    expect(w.text()).toContain("17 more tests needed for 53% by 12/31/2026");
  });

  it("does not draw Random or Results at all for a role the API holds them from", async () => {
    const w = await render(program({ selections: null, results: null }));
    expect(tabLabels(w)).toEqual(["In progress 1", "Medical cards 1", "Roster check 1"]);
    expect(w.text()).toContain("Pat Pending");
    expect(w.text()).not.toContain("Selected, not yet tested");
  });

  it("opens the tab named in the URL and writes the tab back to it", async () => {
    const w = await render(program(), "/drug-alcohol?tab=medical");
    expect(w.text()).toContain("Medical cards expiring in the next 60 days");
    expect(w.text()).toContain("Med Diff");
    expect(w.text()).toContain("01/01/2027");
    expect(w.text()).toContain("11/10/2026");
    // The flagged list names each source and why the file keeps its date.
    expect(w.text()).toContain("Sources disagree");
    expect(w.text()).toContain("Scan Kept");
    expect(w.text()).toContain("Scanned card on file");
    expect(w.text()).toContain("Earliest of the sources");
    await w.findAll('[role="tab"]').find((t) => t.text().startsWith("Roster check"))!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.tab).toBe("roster");
    const link = w.findAll("a").find((a) => a.text() === "Bob Outside");
    expect(link?.attributes("href")).toBe("/drivers/d1");
  });

  // F26 (US6b): "Driving here, not in Med-Stop's random pool" drew 178 drivers in one card on staging.
  it("pages a long roster list twenty at a time, says how many there are, and leaves a short one unpaged", async () => {
    const many = Array.from({ length: 45 }, (_, i) => person(`p${i}`, `Driver ${String(i + 1).padStart(2, "0")}`));
    const w = await render(program({ roster: { notInPool: many, leftButInPool: [person("x1", "Left Early")] } }), "/drug-alcohol?tab=roster");
    const [pool, left] = w.findAll("section");
    expect(pool!.findAll("tbody tr, li").length).toBe(20);
    expect(pool!.text()).toContain("Driver 01");
    expect(pool!.text()).not.toContain("Driver 21");
    expect(pool!.text()).toContain("45");
    await pool!.findAll("button").find((b) => b.text() === "Next")!.trigger("click");
    expect(pool!.text()).toContain("Driver 21");
    expect(pool!.text()).not.toContain("Driver 01");
    // One row: no footer to page through.
    expect(left!.text()).toContain("Left Early");
    expect(left!.findAll("button").some((b) => b.text() === "Next")).toBe(false);
  });

  it("in progress shows the stage and when the result is due", async () => {
    const w = await render(program(), "/drug-alcohol?tab=progress");
    expect(w.text()).toContain("At the lab");
    expect(w.text()).toContain("Collected 10/09/2026");
    expect(w.text()).toContain("10/13/2026");
  });

  it("results show one list at a time — history from the first read is a choice, not a second table", async () => {
    const row = (id: string, outcome: "positive" | "refusal", name: string) => ({ source: "test" as const, medstopId: id, person: person(id, name), kind: "drug" as const, reason: "RANDOM", collectedOn: "2026-10-09", outcome });
    const w = await render(program({ results: { recent: [row("t1", "positive", "Pat Positive")], history: [row("t0", "refusal", "Old Case")] } }), "/drug-alcohol?tab=results");
    expect(w.text()).toContain("Pat Positive");
    expect(w.text()).not.toContain("Old Case");
    expect(w.text()).toContain("Show");
  });

  it("a refused order reads as refused before collection; a refused test does not (§7A.16)", async () => {
    const row = (source: "test" | "order", name: string) => ({ source, medstopId: name, person: person(name, name), kind: "drug" as const, reason: "RANDOM", collectedOn: "2026-10-09", outcome: "refusal" as const });
    const w = await render(program({ results: { recent: [row("order", "Rita Refused"), row("test", "Tom Tested")], history: [] } }), "/drug-alcohol?tab=results");
    expect(w.text()).toContain("Rita Refused");
    expect(w.text()).toContain("Tom Tested");
    expect(w.text().match(/Refused before a specimen was collected/g)).toHaveLength(1);
  });

  it("says so when Med-Stop has not been read for more than two hours", async () => {
    const w = await render(program({ syncedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() }));
    expect(w.text()).toContain("more than two hours ago");
  });

  it("says Med-Stop is not connected rather than showing an empty program", async () => {
    const w = await render(program({ connected: false }));
    expect(w.text()).toContain("Med-Stop is not connected yet");
  });

  it("offers Order a test, and Order test on an unordered selection, to the three order roles only (UX3)", async () => {
    state.role = "fleet_manager";
    let w = await render(program());
    expect(w.text()).not.toContain("Order a test");
    expect(w.findAll("button").some((b) => b.text() === "Order test")).toBe(false);

    state.role = "safety_manager";
    w = await render(program());
    await w.findAll("button").find((b) => b.text() === "Order test")!.trigger("click");
    expect(w.find('[data-test="order-drawer"]').text()).toMatch(/^seeded:/);
    state.role = null;
  });

  it("opens the header's drawer unseeded — any reason it orders", async () => {
    state.role = "recruiter";
    const w = await render(program({ selections: null, results: null }));
    await w.findAll("button").find((b) => b.text() === "Order a test")!.trigger("click");
    expect(w.find('[data-test="order-drawer"]').text()).toBe("unseeded");
    state.role = null;
  });
});
