import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

/**
 * The kit card on the vehicle and trailer pages (D-US5): a failed read says what could not load and
 * offers a Retry beside it, rather than a line that sends somebody to the browser's reload button.
 */
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s };
});
const read = vi.hoisted(() => ({ refetch: vi.fn() }));
vi.mock("@/features/inventory/useUnits", () => ({
  useUnitKitQuery: () => ({
    data: ref(undefined), isLoading: ref(false), isError: ref(true), error: ref(new Error("boom")),
    isFetching: ref(false), refetch: read.refetch,
  }),
}));
const UnitKitCard = (await import("./UnitKitCard.vue")).default;

describe("the kit card", () => {
  it("says it could not load what the unit carries, and retries the read", async () => {
    setActivePinia(createPinia());
    const w = mount(UnitKitCard, { props: { kind: "tractor", unitId: "v1" }, global: { stubs: { RouterLink: true } } });
    const alert = w.get("[role=alert]");
    expect(alert.text()).toContain("Could not load what this unit is carrying.");
    await alert.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });
});
