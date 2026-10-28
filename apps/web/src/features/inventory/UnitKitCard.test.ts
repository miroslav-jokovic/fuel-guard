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
const read = vi.hoisted(() => ({ refetch: vi.fn(), unit: null as unknown }));
vi.mock("@/features/inventory/useUnits", () => ({
  useUnitKitQuery: () => ({
    data: ref(read.unit ? { unit: read.unit } : undefined), isLoading: ref(false), isError: ref(!read.unit),
    error: ref(read.unit ? null : new Error("boom")), isFetching: ref(false), refetch: read.refetch,
  }),
}));
const UnitKitCard = (await import("./UnitKitCard.vue")).default;

describe("the kit card", () => {
  it("says it could not load what the unit carries, and retries the read", async () => {
    setActivePinia(createPinia());
    const w = mount(UnitKitCard, { props: { kind: "tractor", unitId: "v1" }, global: { stubs: { RouterLink: true } } });
    const alert = w.get("[role=alert]");
    expect(alert.text()).toContain("Could not load what it is carrying.");
    await alert.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it("lists each line as held of expected, a short line in danger, through FactList (D-US6)", () => {
    setActivePinia(createPinia());
    read.unit = {
      state: "short",
      lines: [
        { assetTypeId: "a1", assetTypeName: "Fire extinguisher", held: 1, expected: 1, delta: 0 },
        { assetTypeId: "a2", assetTypeName: "Reflective triangle", held: 0, expected: 3, delta: -3 },
        { assetTypeId: "a3", assetTypeName: "Spare fuse", held: 0, expected: 0, delta: 0 },
      ],
    };
    const w = mount(UnitKitCard, { props: { kind: "tractor", unitId: "v1" }, global: { stubs: { RouterLink: true } } });
    read.unit = null;
    expect(w.findAll("dt").map((d) => d.text())).toEqual(["Fire extinguisher", "Reflective triangle"]);
    expect(w.findAll("dd").map((d) => d.text())).toEqual(["1 of 1", "0 of 3"]);
    expect(w.findAll("dd")[1]!.classes()).toContain("text-danger-700");
  });
});
