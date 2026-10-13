import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { ROUTE_FUEL_SETTINGS_DEFAULTS } from "@silvicom/shared";

/**
 * F12 (US6b, docs/plans/design-system/UI-STANDARDIZATION.md) — the chain discount rules are a
 * replace-set: Save writes the list on screen and deletes the rest. Before, the card stood outside
 * every read state, so a failed rules read left the list at its initial `[]`, the card said "No
 * discount rules" with Add rule and Save live, and one Save would have erased the company's rules.
 */

const reads = vi.hoisted(() => ({
  settingsFail: false,
  rulesFail: false,
  refetchRules: vi.fn(),
  refetchSettings: vi.fn(),
}));
const query = <T,>(fail: boolean, data: T, refetch: () => void) => ({
  data: ref(fail ? undefined : data),
  isLoading: ref(false),
  isError: ref(fail),
  error: ref(fail ? new Error("502 Bad Gateway") : null),
  isFetching: ref(false),
  refetch,
});
const mutation = () => ({ mutateAsync: vi.fn(), isPending: ref(false) });

vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/composables/useRouteFuelSettings", () => ({
  useRouteFuelSettings: () => query(reads.settingsFail, { ...ROUTE_FUEL_SETTINGS_DEFAULTS }, reads.refetchSettings),
  useSaveRouteFuelSettings: mutation,
}));
vi.mock("@/features/fueling/useDiscountRules", async () => ({
  DISCOUNT_TYPES: (await import("@silvicom/shared")).DISCOUNT_TYPES,
  useDiscountRules: () => query(reads.rulesFail, [{ brand: "loves", type: "flat", cents_off: 12 }], reads.refetchRules),
  useSaveDiscountRules: mutation,
}));

async function mountPage() {
  const Page = (await import("./FuelPlanningSettingsPage.vue")).default;
  const w = mount(Page, { global: { stubs: { PageHeader: true } } });
  await flushPromises();
  return w;
}
const button = (w: Awaited<ReturnType<typeof mountPage>>, label: string) =>
  w.findAll("button").find((b) => b.text().includes(label));

beforeEach(() => {
  setActivePinia(createPinia());
  reads.settingsFail = false;
  reads.rulesFail = false;
  reads.refetchRules.mockClear();
  reads.refetchSettings.mockClear();
});

describe("FuelPlanningSettingsPage — chain discount rules", () => {
  it("shows the saved rules with their editor when both reads answer", async () => {
    const w = await mountPage();
    expect(button(w, "Save discount rules")).toBeTruthy();
    expect(w.text()).not.toContain("No discount rules");
  });

  it("a failed rules read says so, offers no editor, and Retry asks for the rules again", async () => {
    reads.rulesFail = true;
    const w = await mountPage();
    expect(w.text()).toContain("Could not load the discount rules.");
    expect(w.text()).not.toContain("No discount rules");
    expect(button(w, "Save discount rules")).toBeUndefined();
    expect(button(w, "Add rule")).toBeUndefined();
    await button(w, "Retry")!.trigger("click");
    expect(reads.refetchRules).toHaveBeenCalledTimes(1);
    expect(reads.refetchSettings).not.toHaveBeenCalled();
  });

  it("a failed settings read hides the rules editor too — its brands come from that read", async () => {
    reads.settingsFail = true;
    const w = await mountPage();
    expect(w.text()).toContain("Could not load the planner settings.");
    expect(button(w, "Save discount rules")).toBeUndefined();
    expect(button(w, "Add rule")).toBeUndefined();
  });
});
