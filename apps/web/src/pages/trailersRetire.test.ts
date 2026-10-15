import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { answerConfirm } from "@silvicom/ui/testing";

/**
 * Retiring a trailer asks through the product's dialog, not the browser's (D-US7, UI-STANDARDIZATION):
 * the question names the unit, the button says "Retire" in red, and a "no" retires nothing.
 */
const retire = vi.hoisted(() => vi.fn(async (_id: string) => ({})));
vi.mock("@/composables/useTrailers", () => {
  const idle = () => ({ mutateAsync: vi.fn(), isPending: ref(false) });
  const row = {
    id: "t1", unit_number: "T001", make: "Utility", model: "3000R", plate: null, trailer_type: "reefer", is_reefer: true,
    reefer_tank_capacity_gal: 50, assigned_vehicle_id: null, dot_annual_inspection_expires_at: null, status: "active",
    mcleod_trailer_id: null, identity_source: "manual",
  };
  return {
    useTrailersQuery: () => ({ data: ref([row]), isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false) }),
    useCreateTrailer: idle, useUpdateTrailer: idle, useBulkUpdateTrailers: idle,
    useRetireTrailer: () => ({ mutateAsync: retire, isPending: ref(false) }),
  };
});
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([]) }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true, canManage: true }) }));
// DataTable swaps to cards below 768px and jsdom has no matchMedia; the desktop breakpoint is stubbed.
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import TrailersPage from "./TrailersPage.vue";

async function pressRetire() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/trailers", component: { template: "<div/>" } }] });
  await router.push("/trailers");
  await router.isReady();
  // The kebab's panel opens on a click the floating layer measures; its items are drawn inline here.
  const w = mount(TrailersPage, {
    global: { plugins: [router, pinia], stubs: { SlideOver: true, RosterFreshnessLine: true, KebabMenu: { template: "<div><slot /></div>" } } },
  });
  await flushPromises();
  return { pinia, click: async () => {
    await w.findAll("button").find((b) => b.text() === "Retire")!.trigger("click");
    await flushPromises();
  } };
}

describe("retiring a trailer (D-US7)", () => {
  it("asks which unit, in red, and retires nothing on a no", async () => {
    retire.mockClear();
    const { pinia, click } = await pressRetire();
    const asked = answerConfirm(false, pinia);
    await click();
    expect(asked).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Retire trailer T001?", confirmLabel: "Retire", tone: "danger" }),
    );
    expect(retire).not.toHaveBeenCalled();
  });

  it("retires it on a yes", async () => {
    retire.mockClear();
    const { pinia, click } = await pressRetire();
    answerConfirm(true, pinia);
    await click();
    expect(retire).toHaveBeenCalledWith("t1");
  });
});
