import { describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import UnitWorkOrdersCard from "./UnitWorkOrdersCard.vue";

/**
 * The shop's open orders for one unit (UNIT-FILES-PLAN UF5; M3): the unit's shop file, matched to THIS
 * roster row by the F5 mapping rather than by the unit-number string — and no card at all for a reader
 * without the shop section, since "nothing open" is a claim about the truck.
 */
const maintenance = vi.hoisted(() => ({ view: true }));
const asked = vi.hoisted(() => ({ kind: "", id: "" }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ canView: (s: string) => (s === "maintenance" ? maintenance.view : true) }) }));
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => true }));
vi.mock("./useUnitShop", () => ({
  useUnitShopFileQuery: (kind: { value: string }, id: { value: string }) => {
    asked.kind = kind.value;
    asked.id = id.value;
    return {
      data: ref(
        id.value === "v-654"
          ? {
              openWorkOrders: [
                { id: "wo1", referenceNumber: "WO-1", unitNumber: "654", vehicleId: "v-654", trailerId: null, description: "Brake job", priority: "High", openedAt: "2026-10-01T00:00:00Z" },
              ],
            }
          : { openWorkOrders: [] },
      ),
      isPending: ref(false), isError: ref(false), isFetching: ref(false), refetch: vi.fn(),
    };
  },
}));

const mountCard = async (unitId: string) => {
  const w = mount(UnitWorkOrdersCard, { props: { kind: "tractor", unitId }, global: { stubs: { RouterLink: { template: "<a :href=\"JSON.stringify(to)\"><slot /></a>", props: ["to"] } } } });
  await flushPromises();
  return w;
};

describe("UnitWorkOrdersCard", () => {
  it("asks for THIS unit's shop file by roster id, and lists its open orders", async () => {
    maintenance.view = true;
    const w = await mountCard("v-654");
    expect(asked).toEqual({ kind: "tractor", id: "v-654" });
    expect(w.text()).toContain("Brake job");
    expect(w.text()).toContain("WO-1");
    expect(w.text()).toContain("Open in the shop");
  });

  it("says when nothing is open for the unit, and draws nothing for a reader without the shop section", async () => {
    maintenance.view = true;
    expect((await mountCard("v-999")).text()).toContain("Nothing open in the shop for this unit.");
    maintenance.view = false;
    const w = await mountCard("v-654");
    expect(w.find("[data-test=unit-work-orders]").exists()).toBe(false);
    // And no request either: the id handed to the query is blank, so vue-query leaves it disabled.
    expect(asked.id).toBe("");
  });
});
