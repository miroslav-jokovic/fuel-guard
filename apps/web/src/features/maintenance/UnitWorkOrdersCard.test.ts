import { describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import UnitWorkOrdersCard from "./UnitWorkOrdersCard.vue";

/**
 * The shop's open orders for one unit (UNIT-FILES-PLAN UF5): the Shop card's read, narrowed to this
 * unit's number — and no card at all for a reader without the shop section, since "nothing open" is
 * a claim about the truck.
 */
const maintenance = vi.hoisted(() => ({ view: true }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ canView: (s: string) => (s === "maintenance" ? maintenance.view : true) }) }));
vi.mock("./useShopBacklog", () => ({
  useOpenWorkOrdersQuery: () => ({
    data: ref([
      { id: "wo1", referenceNumber: "WO-1", unitNumber: "654", description: "Brake job", priority: "High", openedAt: "2026-10-01T00:00:00Z" },
      { id: "wo2", referenceNumber: "WO-2", unitNumber: "700", description: "Oil change", priority: null, openedAt: null },
    ]),
    isPending: ref(false), isError: ref(false), isFetching: ref(false), refetch: vi.fn(),
  }),
}));

const mountCard = async (unitNumber: string) => {
  const w = mount(UnitWorkOrdersCard, { props: { unitNumber } });
  await flushPromises();
  return w;
};

describe("UnitWorkOrdersCard", () => {
  it("lists only this unit's open orders", async () => {
    maintenance.view = true;
    const w = await mountCard("654");
    expect(w.text()).toContain("Brake job");
    expect(w.text()).toContain("WO-1");
    expect(w.text()).not.toContain("Oil change");
  });

  it("says when nothing is open for the unit, and draws nothing for a reader without the shop section", async () => {
    maintenance.view = true;
    expect((await mountCard("999")).text()).toContain("Nothing open in the shop for this unit.");
    maintenance.view = false;
    expect((await mountCard("654")).find("[data-test=unit-work-orders]").exists()).toBe(false);
  });
});
