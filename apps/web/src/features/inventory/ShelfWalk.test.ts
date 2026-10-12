import { describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import "fake-indexeddb/auto";

/**
 * The shelf walk's own read of the shelf (D-US5). With no stock the walk has no lines left, so a
 * failed read used to fall through to "Every line is counted" — a success callout for a shelf nobody
 * had seen. It must say the shelf could not load, and Retry must read it again. The walk's own
 * failure is CountSessionPage's (`CountSessionPage.test.ts`), so this file starts with a loaded walk.
 */
const SESSION = "44444444-4444-4444-8444-444444444444";
const walk = ref({
  id: SESSION, kind: "location", locationId: "22222222-2222-4222-8222-222222222222", vehicleId: null, trailerId: null,
  holderLabel: "Main shop", startedBy: "u-1", startedByName: "Shop Lead", blind: true, status: "open",
  openedAt: "2026-09-09T10:00:00.000Z", closedAt: null, note: null,
});
const stockRead = vi.hoisted(() => ({ refetch: vi.fn() }));

vi.mock("@/features/inventory/useInventory", async () => {
  const { ref: r } = await import("vue");
  return {
    useCountSessionQuery: () => ({ data: walk, isLoading: r(false), isError: r(false) }),
    useStockQuery: () => ({
      data: r(undefined), isLoading: r(false), isError: r(true), error: r(new Error("boom")),
      isFetching: r(false), refetch: stockRead.refetch,
    }),
    useRecordMovement: () => ({ mutateAsync: vi.fn(), isPending: { value: false } }),
    useCloseCountSession: () => ({ mutateAsync: vi.fn(), isPending: { value: false } }),
  };
});
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true }) }));
vi.mock("vue-router", async (importOriginal) => ({
  ...(({ routerKey, createRouter, createMemoryHistory }) => ({ routerKey, createRouter, createMemoryHistory }))(
    await importOriginal<typeof import("vue-router")>(),
  ),
  useRoute: () => ({ params: { sessionId: SESSION }, path: `/shop/count/${SESSION}`, meta: { title: "Count" } }),
  useRouter: () => ({ push: vi.fn(), resolve: () => ({ name: "not-found", meta: {} }) }),
}));

const ShelfWalk = (await import("./ShelfWalk.vue")).default;

describe("a shelf that fails to load", () => {
  it("says so with a Retry, instead of claiming every line is counted", async () => {
    setActivePinia(createPinia());
    const w = mount(ShelfWalk, { attachTo: document.body, global: { stubs: { Teleport: true } } });
    await flushPromises();
    expect(w.text()).not.toContain("Every line is counted");
    const alert = w.get("[role=alert]");
    expect(alert.text()).toContain("Could not load the shelf.");
    await alert.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    expect(stockRead.refetch).toHaveBeenCalledTimes(1);
    w.unmount();
  });
});
