import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, ref } from "vue";

/**
 * F13: one place follows FleetPal, switched from its row's menu by an admin, and the state column says
 * which and since when. The whole drawer is behind `SHELF_COUNTING_SHOWN` today (Q-MX8 (a)); these pin
 * the switch for the day that constant flips. Desktop breakpoint stubbed as in the read-states suite.
 */
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

const state = vi.hoisted(() => ({ admin: true, calls: [] as Array<{ id: string; follows: boolean }> }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ get admin() { return state.admin; } }) }));
vi.mock("./useInventory", async () => {
  const { ref } = await import("vue");
  const mutation = () => ({ isPending: ref(false), mutateAsync: () => Promise.resolve() });
  return {
    useLocationsQuery: () => ({
      data: ref([
        { id: "l1", name: "Main shop", code: "MAIN", address: null, active: true, fleetpalFrom: "2026-11-16T14:00:00Z" },
        { id: "l2", name: "North yard", code: "YARD", address: null, active: true, fleetpalFrom: null },
        { id: "l3", name: "Old bay", code: "OLD", address: null, active: false, fleetpalFrom: null },
      ]),
      isLoading: ref(false),
      isError: ref(false),
      isFetching: ref(false),
      refetch: () => undefined,
    }),
    useCreateLocation: mutation,
    useUpdateLocation: mutation,
    useSetFleetpalShelf: () => ({
      isPending: ref(false),
      mutateAsync: (input: { id: string; follows: boolean }) => {
        state.calls.push(input);
        return Promise.resolve();
      },
    }),
  };
});

import LocationsDrawer from "./LocationsDrawer.vue";

const SlideOver = defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) });
// The row menu opened: its items are what is being asserted, not the popover mechanics.
const KebabMenu = defineComponent({ props: { triggerLabel: String }, setup: (p, { slots }) => () => h("div", { "data-menu": p.triggerLabel }, slots.default?.()) });
const render = () => mount(LocationsDrawer, { props: { open: true }, attachTo: document.body, global: { stubs: { SlideOver, KebabMenu } } });
const menu = (w: ReturnType<typeof render>, name: string) => w.get(`[data-menu="Actions for ${name}"]`);

beforeEach(() => {
  setActivePinia(createPinia());
  state.admin = true;
  state.calls.length = 0;
});

describe("Places — following FleetPal", () => {
  it("says which place follows FleetPal and since when, and no other", () => {
    const w = render();
    const marks = w.findAll('[data-testid="fleetpal-from"]');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.text()).toMatch(/^Follows FleetPal since /);
    w.unmount();
  });

  it("offers an admin Stop on the following place and Start on an open one, and nothing on a closed one", async () => {
    const w = render();
    expect(menu(w, "Main shop").text()).toContain("Stop following FleetPal");
    expect(menu(w, "North yard").text()).toContain("Follow FleetPal from now");
    expect(menu(w, "Old bay").text()).not.toContain("FleetPal");
    await menu(w, "North yard").findAll("button").find((b) => b.text() === "Follow FleetPal from now")!.trigger("click");
    expect(state.calls).toEqual([{ id: "l2", follows: true }]);
    w.unmount();
  });

  it("offers no FleetPal switch to anyone but an admin — it decides what an outside system moves", () => {
    state.admin = false;
    const w = render();
    expect(w.text()).not.toContain("Follow FleetPal from now");
    expect(w.text()).not.toContain("Stop following FleetPal");
    w.unmount();
  });
});
