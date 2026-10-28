import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { RoadsideRepairDueDto } from "@silvicom/shared";
import { ROUTE_TABLE } from "@/router/table";

/**
 * Roadside repairs due, the Shop's list (IC11 B2b, Q-IC16 (a); the standard list since IC16). What it can get wrong:
 *
 *   1. **Opens on the oldest backlog** instead of what is due now, or lists a recorded repair as open.
 *   2. **Arrives from the bell and shows something else** — the alert's inspection not narrowed to, or its open unit
 *      not in the drawer.
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
// The desktop table: jsdom has no `matchMedia`, and DataTable would otherwise draw its narrow cards.
vi.mock("@vueuse/core", async (orig) => {
  const { ref: r } = await import("vue");
  return { ...((await orig()) as Record<string, unknown>), useMediaQuery: () => r(true) };
});

const RoadsideRepairsPage = (await import("@/features/roadside/RoadsideRepairsPanel.vue")).default;
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
  const w = mount(RoadsideRepairsPage as never, { global: { plugins: [router], stubs: { SlideOver: { props: ["open", "title"], template: "<div v-if='open' data-test='drawer' :data-title='title'><slot /></div>" } } } });
  await flushPromises();
  return { w, router };
}
const unitsListed = (w: Awaited<ReturnType<typeof page>>["w"]) => w.findAll("[data-test='repair-row-open']").map((b) => b.text());

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T17:00:00Z"));
  inspectionOpens = true;
  due.value = [unit("500", "2026-03-01"), unit("612", "2026-10-21"), unit("700", "2026-10-10", { decision: recorded })];
});

describe("roadside repairs due", () => {
  it("lists the open repairs nearest to today first, with what FleetPal shows and the clock", async () => {
    const { w } = await page();
    expect(unitsListed(w)).toEqual(["Truck 612", "Truck 500"]);
    expect(w.findAll("[data-test='repair-due-badge']").map((b) => b.text())).toEqual(["2 days left", "232 days overdue"]);
    expect(w.findAll("[data-test='repair-proposal-short']").map((b) => b.text())).toEqual(["No work order yet", "No work order yet"]);
    expect(w.find("[data-test='drawer']").exists()).toBe(false);
  });

  it("opens a row in the drawer on the inspection page's own component, and keeps it in the URL", async () => {
    const { w, router } = await page();
    await w.findAll("[data-test='repair-row-open']")[0]!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.unit).toBe("612");
    expect(w.get("[data-test='drawer']").attributes("data-title")).toBe("Truck 612");
    expect(w.findAllComponents(RepairUnitDecision)).toHaveLength(1);
  });

  it("keeps a recorded repair under Show: Recorded, and finds a unit by its report", async () => {
    expect(unitsListed((await page("?show=recorded")).w)).toEqual(["Truck 700"]);
    expect(unitsListed((await page("?search=IL500")).w)).toEqual(["Truck 500"]);
  });

  it("arriving from the bell, narrows to its inspection, under the Show it is in, with its unit open", async () => {
    // Another recorded unit, on another inspection: narrowing leaves it out.
    due.value = [...due.value!, unit("801", "2026-10-09", { decision: recorded })];
    const { w, router } = await page("?inspection=insp-700");
    await flushPromises();
    expect(router.currentRoute.value.query.show).toBe("recorded");
    expect(unitsListed(w)).toEqual(["Truck 700"]);
    expect(router.currentRoute.value.query.unit).toBe("700");
  });

  it("offers the inspection only to a reader who can open it", async () => {
    expect((await page("?unit=612")).w.text()).toContain("Open the inspection");
    inspectionOpens = false;
    expect((await page("?unit=612")).w.text()).not.toContain("Open the inspection");
  });

  it("says so when nothing is open", async () => {
    due.value = [unit("700", "2026-10-10", { decision: recorded })];
    expect((await page()).w.text()).toContain("Every roadside repair of the last year is recorded.");
  });
});
