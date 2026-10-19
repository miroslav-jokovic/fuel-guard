import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { RoadsideRepairDueDto } from "@silvicom/shared";
import { ROUTE_TABLE } from "@/router/table";

/**
 * Roadside repairs due, the Shop's page (IC11 B2b, Q-IC16 (a)). What it can get wrong:
 *
 *   1. **Opens on the oldest backlog** instead of what is due now, or lists a recorded repair as open.
 *   2. **Arrives from the bell and shows something else** — the alert's inspection on the other tab, or not
 *      brought into view.
 *   3. **Links a technician to the inspection page** they cannot open.
 *   4. **Decides on a component of its own** rather than the inspection page's (one way to name a repair).
 */

const due = ref<RoadsideRepairDueDto[] | undefined>([]);
vi.mock("@/features/roadside/useRoadsideInspections", async () => {
  const { ref: r } = await import("vue");
  return {
    useRoadsideRepairsDueQuery: () => ({ data: due, isLoading: r(false), isError: r(false), error: r(null), isFetching: r(false), refetch: vi.fn() }),
    useDecideRepair: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: r(false), error: r(null) }),
    RepairDecisionError: class extends Error {},
  };
});
vi.mock("@/composables/useOrgTimezone", async () => {
  const { ref: r } = await import("vue");
  return { useOrgTimezone: () => ({ zone: r("America/Chicago") }) };
});
let inspectionOpens = true;
vi.mock("@/composables/useOpens", () => ({
  useOpens: () => (to: { name?: string }) => (to.name === "roadside-inspection" ? inspectionOpens : true),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: (s: string) => s === "maintenance" }) }));

const RoadsideRepairsPage = (await import("@/pages/RoadsideRepairsPage.vue")).default;
const RepairUnitDecision = (await import("@/features/roadside/RepairUnitDecision.vue")).default;

const unit = (unitId: string, dueOn: string, o: Partial<RoadsideRepairDueDto> = {}): RoadsideRepairDueDto => ({
  unitId, unit: { seq: 1, kind: "tractor", companyNumber: unitId }, violations: [{ code: "393.47D", description: "Brakes" }], dueOn,
  proposal: { outcome: "no_candidate", candidates: [], readAt: "x" }, decision: null, basedOn: `r-${unitId}`,
  inspection: { id: `insp-${unitId}`, reportNumber: `IL${unitId}`, reportState: "IL", inspectionDate: "2026-10-06", locationDesc: "I-55" },
  ...o,
});
const recorded = { outcome: "accepted" as const, workOrder: null, note: null, decidedBy: "Pat", decidedAt: "2026-10-12T00:00:00Z" };

async function page(query = "") {
  const router = createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] });
  await router.push(`/shop/roadside-repairs${query}`);
  await router.isReady();
  const w = mount(RoadsideRepairsPage as never, { global: { plugins: [router] }, attachTo: document.body.appendChild(document.createElement("div")) });
  await flushPromises();
  return { w, router };
}
const names = (w: Awaited<ReturnType<typeof page>>["w"]) => w.findAll("[data-test='repair-unit'] h3").map((h) => h.text());

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T17:00:00Z"));
  inspectionOpens = true;
  due.value = [unit("500", "2026-03-01"), unit("612", "2026-10-21"), unit("700", "2026-10-10", { decision: recorded })];
});

describe("roadside repairs due", () => {
  it("opens on the open repairs nearest to today, each decided on the inspection page's own component", async () => {
    const { w } = await page();
    expect(names(w)).toEqual(["Truck 612", "Truck 500"]);
    expect(w.findAllComponents(RepairUnitDecision)).toHaveLength(2);
    expect(w.get("[data-test='repair-where']").text()).toContain("Report IL612 · inspected 10/06/2026 · I-55, IL");
  });

  it("keeps a recorded repair on its own tab", async () => {
    const { w } = await page("?tab=recorded");
    expect(names(w)).toEqual(["Truck 700"]);
  });

  it("arriving from the bell, opens the tab its inspection is on and brings it into view", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const { w, router } = await page("?inspection=insp-700");
    expect(router.currentRoute.value.query.tab).toBe("recorded");
    await flushPromises();
    expect(names(w)).toEqual(["Truck 700"]);
    expect(scrolled).toHaveBeenCalled();
  });

  it("offers the inspection only to a reader who can open it", async () => {
    expect((await page()).w.text()).toContain("Open the inspection");
    inspectionOpens = false;
    expect((await page()).w.text()).not.toContain("Open the inspection");
  });

  it("says so when nothing is open", async () => {
    due.value = [unit("700", "2026-10-10", { decision: recorded })];
    expect((await page()).w.get("[data-test='repairs-empty']").text()).toBe("Every roadside repair of the last year is recorded.");
  });
});
