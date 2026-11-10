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
  default: { props: ["open", "seed"], template: `<div v-if="open" data-test="order-drawer">{{ seed ? (seed.kind === "recollection" ? "recollect:" + seed.testId + ":" + seed.medstopId + ":" + seed.reason : "seeded:" + seed.selectionId) : "unseeded" }}</div>` },
}));
vi.mock("@/features/drugAlcohol/useDrugAlcoholProgram", () => ({
  useDrugAlcoholProgram: () => ({
    data: computed(() => state.program), isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn(),
  }),
}));

import DrugAlcoholPage from "./DrugAlcoholPage.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { FilterBar } from "@silvicom/ui";

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
    draws: [
      { selectionId: "s1", service: "drug", selectedOn: "2026-10-06", daysSince: 7, person: person("d9", "Dee Due"), ordered: false, state: "due", period: "current", medstopStatus: "OPEN" },
      // Dated ahead of today inside the current quarter: still the quarter's draw, still to test (D-MSUX19).
      { selectionId: "s4", service: "alcohol", selectedOn: "2026-11-20", daysSince: -38, person: person("d4", "Fay Future"), ordered: false, state: "due", period: "current", medstopStatus: "OPEN" },
      { selectionId: "s5", service: "drug", selectedOn: "2026-12-27", daysSince: -75, person: person("d3", "Alma Alternate"), ordered: false, state: "alternate", period: "current", medstopStatus: "RESERVE" },
      { selectionId: "s2", service: "drug", selectedOn: "2027-01-20", daysSince: -99, person: person("d8", "Uma Upcoming"), ordered: false, state: "upcoming", period: "later", medstopStatus: "OPEN" },
      { selectionId: "s3", service: "alcohol", selectedOn: "2026-03-02", daysSince: 225, person: person("d7", "Tia Tested"), ordered: true, state: "tested", period: "earlier", medstopStatus: "COMPLETED" },
    ],
    currentPeriod: { startsOn: "2026-10-01", endsOn: "2026-12-31", months: 3 },
    // §7A.19: Dee's fleet is linked and a colleague moves her load; Fay's fleet is not linked; Alma has
    // a truck in no fleet and no load; Tia holds no truck.
    dispatch: {
      d9: { unitNumber: "773", fleetCode: "VINNIEV", fleetDispatcher: "Vinnie V", loadDispatcher: "asen" },
      d4: { unitNumber: "512", fleetCode: "KANE", fleetDispatcher: null, loadDispatcher: "kane" },
      d3: { unitNumber: "88", fleetCode: null, fleetDispatcher: null, loadDispatcher: null },
    },
  },
  inProgress: [
    { key: "test:t1", person: person("d5", "Pat Pending"), kind: "drug", reason: "PRE-EMPLOYMENT", stage: "At the lab", orderedOn: null, collectedOn: "2026-10-09", expectedOn: "2026-10-13", daysWaiting: 4 },
  ],
  results: { all: [], recent: [], history: [] },
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
    expect(tabLabels(w)).toEqual(["Random selections 2", "In progress 1", "Results", "Medical cards 1", "Roster check 1"]);
    expect(w.text()).toContain("Dee Due");
    expect(w.text()).toContain("Not ordered");
    expect(w.text()).toContain("17 more tests needed for 53% by 12/31/2026");
  });

  it("opens Random on this quarter's draw — every open one orderable, whatever day Med-Stop dated it — and Whole year lists the rest (D-MSUX19)", async () => {
    state.role = "safety_manager";
    const w = await render(program());
    state.role = null;
    expect(w.text()).toContain("This quarter's draw runs 10/01/2026 – 12/31/2026.");
    for (const name of ["Dee Due", "Fay Future"]) expect(w.text()).toContain(name);
    for (const name of ["Alma Alternate", "Uma Upcoming", "Tia Tested"]) expect(w.text()).not.toContain(name);
    expect(w.findAll("button").filter((b) => b.text() === "Order test")).toHaveLength(2);
    w.findComponent(FilterSelect).vm.$emit("update:modelValue", "all");
    await flushPromises();
    for (const name of ["Dee Due", "Fay Future", "Alma Alternate", "Uma Upcoming", "Tia Tested"]) expect(w.text()).toContain(name);
    // A draw in a LATER period is the only open one not offered.
    expect(w.findAll("button").filter((b) => b.text() === "Order test")).toHaveLength(2);
  });

  it("names whom to call for each drawn driver — the fleet's dispatcher, a covering colleague beside it (§7A.19)", async () => {
    const w = await render(program());
    w.findComponent(FilterSelect).vm.$emit("update:modelValue", "all");
    await flushPromises();
    // jsdom lays the table out as cards, so the four answers are read off the rendered text.
    const text = w.text();
    expect(text).toContain("Vinnie VTruck 773 · load dispatched by asen");
    expect(text).toContain("kaneTruck 512 · dispatching its load");
    expect(text).toContain("—Truck 88 · in no fleet, no load");
    expect(text).toContain("No truck");
  });

  it("opens on the whole year when no pool covers today", async () => {
    const base = program();
    const w = await render(program({ selections: { draws: base.selections!.draws, currentPeriod: null, dispatch: {} } }));
    expect(w.text()).not.toContain("draw runs");
    expect(w.text()).toContain("Show: Whole year");
    expect(w.text()).toContain("Tia Tested");
  });

  it("does not draw Random or Results at all for a role the API holds them from", async () => {
    const w = await render(program({ selections: null, results: null }));
    expect(tabLabels(w)).toEqual(["In progress 1", "Medical cards 1", "Roster check 1"]);
    expect(w.text()).toContain("Pat Pending");
    expect(w.text()).not.toContain("Selected, not yet tested");
  });

  it("opens the tab named in the URL and writes the tab back to it", async () => {
    const w = await render(program(), "/drug-alcohol?tab=medical");
    expect(w.text()).toContain("A driver may not drive on an expired card.");
    expect(w.text()).toContain("Med Diff");
    expect(w.text()).toContain("11/10/2026");
    // The flagged list is Show's other choice, and names each source and why the file keeps its date.
    expect(w.text()).not.toContain("Scan Kept");
    w.findComponent(FilterSelect).vm.$emit("update:modelValue", "disagree");
    await flushPromises();
    expect(router.currentRoute.value.query["medical.show"]).toBe("disagree");
    expect(w.text()).toContain("Scan Kept");
    expect(w.text()).toContain("01/01/2027");
    expect(w.text()).toContain("Scanned card on file");
    expect(w.text()).toContain("Earliest of the sources");
    await w.findAll('[role="tab"]').find((t) => t.text().startsWith("Roster check"))!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.tab).toBe("roster");
    const link = w.findAll("a").find((a) => a.text() === "Bob Outside");
    expect(link?.attributes("href")).toBe("/drivers/d1");
  });

  // F26 (US6b): "Driving here, not in Med-Stop's random pool" drew 178 drivers in one card on staging.
  it("pages a long roster list twenty at a time with its page in the URL, and Show switches to the other list", async () => {
    const many = Array.from({ length: 45 }, (_, i) => person(`p${i}`, `Driver ${String(i + 1).padStart(2, "0")}`));
    const w = await render(program({ roster: { notInPool: many, leftButInPool: [person("x1", "Left Early")] } }), "/drug-alcohol?tab=roster");
    expect(w.findAll("tbody tr, li").length).toBe(20);
    expect(w.text()).toContain("Driver 01");
    expect(w.text()).not.toContain("Driver 21");
    expect(w.text()).toContain("45 people");
    await w.findAll("button").find((b) => b.text() === "Next")!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query["roster.page"]).toBe("2");
    expect(w.text()).toContain("Driver 21");
    expect(w.text()).not.toContain("Driver 01");
    w.findComponent(FilterSelect).vm.$emit("update:modelValue", "left");
    await flushPromises();
    expect(w.text()).toContain("Med-Stop can still select these people.");
    expect(w.text()).toContain("Left Early");
    expect(w.text()).not.toContain("Driver 21");
  });

  it("searches each tab, keeps the search in the URL under the tab's own name, and Clear filters keeps Show", async () => {
    const w = await render(program(), "/drug-alcohol?random.show=all");
    await w.find('input[type="search"]').setValue("tia");
    await new Promise((r) => setTimeout(r, 300));
    await flushPromises();
    expect(router.currentRoute.value.query["random.search"]).toBe("tia");
    expect(w.text()).toContain("Tia Tested");
    expect(w.text()).not.toContain("Dee Due");
    await w.findAll("button").find((b) => b.text() === "Clear filters")!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query["random.search"]).toBeUndefined();
    expect(router.currentRoute.value.query["random.show"]).toBe("all");
    expect(w.text()).toContain("Dee Due");
  });

  it("filters by test, and a link with the filter opens the list already narrowed", async () => {
    const w = await render(program(), "/drug-alcohol?random.show=all&random.test=alcohol");
    expect(w.text()).toContain("Fay Future");
    expect(w.text()).toContain("Tia Tested");
    expect(w.text()).not.toContain("Dee Due");
    expect(w.text()).toContain("2 random draws");
  });

  it("filters results by what they were, offering only results the list holds", async () => {
    const row = (id: string, outcome: "positive" | "refusal", name: string) => ({ source: "test" as const, medstopId: id, person: person(id, name), kind: "drug" as const, reason: "RANDOM", collectedOn: "2026-10-09", outcome });
    const w = await render(program({ results: { all: [row("t1", "positive", "Pat Positive"), row("t2", "refusal", "Rae Refused")], recent: [row("t1", "positive", "Pat Positive"), row("t2", "refusal", "Rae Refused")], history: [] } }), "/drug-alcohol?tab=results&results.result=refusal");
    expect(w.text()).toContain("Rae Refused");
    expect(w.text()).not.toContain("Pat Positive");
    // Result is the fifth filter, so it sits in the bar's "Filters" popover (UI adoption: four inline).
    await w.find('button[aria-haspopup="dialog"]').trigger("click");
    await flushPromises();
    const resultSelect = w.findAllComponents(FilterSelect).find((f) => f.props("label") === "Result")!;
    expect((resultSelect.props("options") as { value: string }[]).map((o) => o.value)).toEqual(["positive", "refusal"]);
  });

  it("in progress shows the stage and when the result is due", async () => {
    const w = await render(program(), "/drug-alcohol?tab=progress");
    expect(w.text()).toContain("At the lab");
    expect(w.text()).toContain("Collected 10/09/2026");
    expect(w.text()).toContain("10/13/2026");
  });

  it("results open on every result of the year, negatives included; needs-review and the first read are choices of Show", async () => {
    const row = (id: string, outcome: "positive" | "refusal" | "negative", name: string) => ({ source: "test" as const, medstopId: id, person: person(id, name), kind: "drug" as const, reason: "RANDOM", collectedOn: "2026-10-09", outcome });
    const results = {
      all: [row("t2", "negative", "Nina Negative"), row("t1", "positive", "Pat Positive"), row("t0", "refusal", "Old Case")],
      recent: [row("t1", "positive", "Pat Positive")],
      history: [row("t0", "refusal", "Old Case")],
    };
    const all = await render(program({ results }), "/drug-alcohol?tab=results");
    // The tab's number is the list it opens on, not Needs review's 1.
    expect(tabLabels(all)).toContain("Results 3");
    expect(all.text()).toContain("Nina Negative");
    expect(all.text()).toContain("Pat Positive");
    expect(all.text()).toContain("Old Case");
    const show = all.findAllComponents(FilterSelect).find((f) => f.props("label") === "Show")!;
    expect((show.props("options") as { label: string }[]).map((o) => o.label)).toEqual(["All results (3)", "Needs review (1)", "Found on the first read (1)"]);

    const review = await render(program({ results }), "/drug-alcohol?tab=results&results.show=recent");
    expect(review.text()).toContain("Pat Positive");
    expect(review.text()).not.toContain("Nina Negative");
    expect(review.text()).not.toContain("Old Case");
  });

  it("clearing Show goes back to the list the tab opens on, on Results, Medical cards and Roster check — never an error", async () => {
    const row = (id: string, outcome: "positive" | "negative", name: string) => ({ source: "test" as const, medstopId: id, person: person(id, name), kind: "drug" as const, reason: "RANDOM", collectedOn: "2026-10-09", outcome });
    const results = { all: [row("t2", "negative", "Nina Negative"), row("t1", "positive", "Pat Positive")], recent: [row("t1", "positive", "Pat Positive")], history: [] };
    for (const [url, chosen, opened] of [
      ["/drug-alcohol?tab=results&results.show=recent", "Pat Positive", "Nina Negative"],
      ["/drug-alcohol?tab=medical&medical.show=disagree", "Scan Kept", "Med Diff"],
      ["/drug-alcohol?tab=roster&roster.show=left", "Left Early", "Bob Outside"],
    ] as const) {
      const w = await render(program({ results, roster: { notInPool: [person("d1", "Bob Outside")], leftButInPool: [person("x1", "Left Early")] } }), url);
      const show = w.findAllComponents(FilterSelect).find((f) => f.props("label") === "Show")!;
      expect(w.text()).toContain(chosen);
      await show.find('[aria-label="Clear Show filter"]').trigger("click");
      await flushPromises();
      expect(w.text()).toContain(opened);
      // The list it opens on is Show's no-choice row: no ✕ to click again.
      expect(show.find('[aria-label="Clear Show filter"]').exists()).toBe(false);
    }
    // A link from before this change still opens a list, not an error.
    const stale = await render(program({ results }), "/drug-alcohol?tab=results&results.show=any");
    expect(stale.text()).toContain("Nina Negative");
  });

  it("narrows results by reason and by a collection date range, an undated row inside no range", async () => {
    const row = (id: string, reason: string, collectedOn: string | null, name: string) => ({ source: "test" as const, medstopId: id, person: person(id, name), kind: "drug" as const, reason, collectedOn, outcome: "negative" as const });
    const all = [
      row("a", "RANDOM", "2026-11-04", "Rand Recent"),
      row("b", "PRE-EMPLOYMENT", "2026-11-09", "Pree Recent"),
      row("c", "RANDOM", "2026-11-03", "Rand Older"),
      row("d", "POST-ACCIDENT", null, "Undated Person"),
    ];
    const results = { all, recent: [], history: [] };
    const w = await render(program({ results }), "/drug-alcohol?tab=results&results.reason=RANDOM");
    expect(w.text()).toContain("Rand Recent");
    expect(w.text()).toContain("Rand Older");
    expect(w.text()).not.toContain("Pree Recent");
    const reasons = w.findAllComponents(FilterSelect).find((f) => f.props("label") === "Reason")!;
    expect((reasons.props("options") as { value: string }[]).map((o) => o.value)).toEqual(["POST-ACCIDENT", "PRE-EMPLOYMENT", "RANDOM"]);

    const week = await render(program({ results }), "/drug-alcohol?tab=results&results.from=2026-11-04&results.to=2026-11-10");
    expect(week.text()).toContain("Rand Recent");
    expect(week.text()).toContain("Pree Recent");
    expect(week.text()).not.toContain("Rand Older");
    expect(week.text()).not.toContain("Undated Person");
    // The open tab's number is what the range left on screen, not the year's four.
    expect(tabLabels(week)).toContain("Results 2");
    // A hand-edited range that is not a day narrows nothing.
    const junk = await render(program({ results }), "/drug-alcohol?tab=results&results.from=yesterday");
    expect(junk.text()).toContain("Rand Older");
    expect(tabLabels(junk)).toContain("Results 4");
  });

  it("the open tab's number follows its filters; the other tabs keep their own counts", async () => {
    const many = [person("d1", "Bob Outside"), person("d2", "Ann Other")];
    const w = await render(program({ roster: { notInPool: many, leftButInPool: [person("x1", "Left Early")] } }), "/drug-alcohol?tab=roster");
    expect(tabLabels(w)).toContain("Roster check 3");
    w.findComponent(FilterBar).vm.$emit("update:search", "Bob");
    await flushPromises();
    expect(tabLabels(w)).toContain("Roster check 1");
    expect(tabLabels(w)).toContain("Medical cards 1");
    // Show on another list counts that list, though Show is not a filter.
    const left = await render(program({ roster: { notInPool: many, leftButInPool: [person("x1", "Left Early")] } }), "/drug-alcohol?tab=roster&roster.show=left");
    expect(tabLabels(left)).toContain("Roster check 1");
    // Nothing narrowed: Random's number is still the draws to test, not the quarter it opens on (R5).
    const random = await render(program());
    expect(tabLabels(random)[0]).toBe("Random selections 2");
    // Leaving a narrowed tab hands its number back.
    await w.findAll('[role="tab"]').find((t) => t.text().startsWith("Medical"))!.trigger("click");
    await flushPromises();
    expect(tabLabels(w)).toContain("Roster check 3");
  });

  it("a refused order reads as refused before collection; a refused test does not (§7A.16)", async () => {
    const row = (source: "test" | "order", name: string) => ({ source, medstopId: name, person: person(name, name), kind: "drug" as const, reason: "RANDOM", collectedOn: "2026-10-09", outcome: "refusal" as const });
    const w = await render(program({ results: { all: [row("order", "Rita Refused"), row("test", "Tom Tested")], recent: [row("order", "Rita Refused"), row("test", "Tom Tested")], history: [] } }), "/drug-alcohol?tab=results");
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

  it("offers 'Order a recollection' on a negative-dilute drug result to a reader who may order, seeded with that test (MSO3)", async () => {
    const row = (id: string, outcome: "negative_dilute" | "positive", kind: "drug" | "alcohol" = "drug", reason = "POST-ACCIDENT") =>
      ({ source: "test" as const, medstopId: id, person: person(id, `Name ${id}`), kind, reason, collectedOn: "2026-10-09", outcome });
    const flagged = [row("t1", "negative_dilute"), row("t2", "positive"), row("t3", "negative_dilute", "alcohol"), row("t4", "negative_dilute", "drug", "OTHER")];
    const results = { all: flagged, recent: flagged, history: [] };
    state.role = "safety_manager";
    const w = await render(program({ results }), "/drug-alcohol?tab=results");
    const buttons = w.findAll("button").filter((b) => b.text() === "Order a recollection");
    expect(buttons).toHaveLength(1);
    await buttons[0]!.trigger("click");
    await flushPromises();
    expect(w.find('[data-test="order-drawer"]').text()).toBe("recollect:t1:m-t1:POST-ACCIDENT");
    state.role = "auditor";
    const viewer = await render(program({ results }), "/drug-alcohol?tab=results");
    expect(viewer.text()).not.toContain("Order a recollection");
    state.role = null;
  });
});

