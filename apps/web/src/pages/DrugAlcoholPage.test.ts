import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import { computed, ref } from "vue";
import type { DrugAlcoholProgram } from "@silvicom/shared";

/**
 * Safety › Drug & Alcohol, mounted (MEDSTOP-PLAN.md §6 F-1/F-2). Pinned: a driver outside the random
 * pool is named and linked to their page; the pool caption says how many tests the year still needs;
 * and the selected-and-untested list is ABSENT — not an empty table claiming nobody is due — when the
 * API holds it back from the reader's role.
 */

const state = vi.hoisted(() => ({ program: null as unknown }));
vi.mock("@/features/drugAlcohol/useDrugAlcoholProgram", () => ({
  useDrugAlcoholProgram: () => ({
    data: computed(() => state.program), isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn(),
  }),
}));

import DrugAlcoholPage from "./DrugAlcoholPage.vue";

const program = (over: Partial<DrugAlcoholProgram> = {}): DrugAlcoholProgram => ({
  connected: true,
  syncedAt: "2026-10-13T14:00:00Z",
  lastError: null,
  pools: [{
    service: "drug", label: "Drug", poolYear: 2026, endsOn: "2026-12-31", frequency: "QUARTERLY", targetPercent: 53,
    currentPercent: 42.58, membersAvg: 155, completedTests: 66, requiredTests: 83, testsOwed: 17, scheduledTests: 17, lostSelections: 12,
  }],
  selections: {
    due: [{ selectionId: "s1", service: "drug", selectedOn: "2026-10-06", daysSince: 7, person: { driverId: "d9", medstopId: "m9", name: "Dee Due" }, ordered: false }],
    upcoming: [],
  },
  roster: {
    notInPool: [{ driverId: "d1", medstopId: null, name: "Bob Outside" }],
    leftButInPool: [],
    licenceWeLack: [],
    medicalDisagrees: [{ person: { driverId: "d2", medstopId: "m2", name: "Med Diff" }, ours: "2027-01-01", medstop: "2027-07-22" }],
    medstopActive: 170,
    matched: 152,
  },
  ...over,
});

async function render(p: DrugAlcoholProgram) {
  state.program = p;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/drug-alcohol", component: { template: "<div/>" }, meta: { title: "Drug & Alcohol" } },
      { path: "/drivers/:id", name: "driver-detail", component: { template: "<div/>" } },
    ],
  });
  await router.push("/drug-alcohol");
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(DrugAlcoholPage, { global: { plugins: [router, pinia] } });
  await flushPromises();
  return w;
}

describe("DrugAlcoholPage", () => {
  it("names the driver outside the random pool and links to their page", async () => {
    const w = await render(program());
    const link = w.findAll("a").find((a) => a.text() === "Bob Outside");
    expect(link?.attributes("href")).toBe("/drivers/d1");
    expect(w.text()).toContain("Driving here, not in Med-Stop's random pool");
  });

  it("says how many tests the year still needs and how many draws were lost", async () => {
    const w = await render(program());
    expect(w.text()).toContain("17 more tests needed for 53% by 12/31/2026");
    expect(w.text()).toContain("12 draws ended untested this year");
  });

  it("shows the DER who is selected and not yet ordered", async () => {
    const w = await render(program());
    expect(w.text()).toContain("Dee Due");
    expect(w.text()).toContain("Not ordered");
  });

  it("leaves the selection list out entirely when the API holds it back", async () => {
    const w = await render(program({ selections: null }));
    expect(w.text()).not.toContain("Selected, not yet tested");
    expect(w.text()).not.toContain("No one is waiting on a random test");
  });

  it("shows both medical dates when they disagree", async () => {
    const w = await render(program());
    expect(w.text()).toContain("Ours 01/01/2027 · Med-Stop 07/22/2027");
  });

  it("says Med-Stop is not connected rather than showing an empty program", async () => {
    const w = await render(program({ connected: false }));
    expect(w.text()).toContain("Med-Stop is not connected yet");
  });
});
