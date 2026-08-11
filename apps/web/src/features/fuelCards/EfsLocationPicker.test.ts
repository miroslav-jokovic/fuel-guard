import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { EfsLocation } from "@fuelguard/shared";
import EfsLocationPicker from "./EfsLocationPicker.vue";

/**
 * The picker exists because nobody knows a 6-digit EFS location id — they know "the Love's on I-57".
 * Two properties matter and both are about NOT dialling the vendor: no query below two characters,
 * and no live search table left open after a choice has been made.
 */

const search = vi.hoisted(() => ({
  data: { value: { locations: [] as EfsLocation[] } },
  isLoading: { value: false },
  isError: { value: false },
  error: { value: null as Error | null },
  refetch: vi.fn(),
  lastQuery: { value: null as unknown },
}));

vi.mock("./useEfsCards", () => ({
  useEfsLocationSearch: (query: { value: unknown }) => {
    search.lastQuery.value = query;
    return search;
  },
}));

vi.mock("@fuelguard/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fuelguard/ui")>()),
  AppSearchField: {
    props: ["modelValue", "placeholder"],
    emits: ["update:modelValue"],
    template: `<input data-testid="search" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
}));

vi.mock("@/components/ui/DataTable.vue", () => ({
  default: {
    props: ["columns", "rows", "rowKey", "dense", "loading", "error", "emptyText"],
    template: `<table data-testid="results"><tr v-for="row in rows" :key="row.locId">
      <td>{{ row.name }}</td><td><slot name="actions" :row="row" /></td></tr></table>`,
  },
}));

const loves = (over: Partial<EfsLocation> = {}): EfsLocation => ({
  locId: "442013", name: "LOVES 442", city: "Effingham", state: "IL",
  country: "USA", addr1: null, phone: null, ...over,
});

const wrappers: VueWrapper[] = [];
function render(modelValue: EfsLocation | null = null) {
  const wrapper = mount(EfsLocationPicker, { props: { modelValue } });
  wrappers.push(wrapper);
  return wrapper;
}

afterEach(() => {
  for (const w of wrappers.splice(0)) w.unmount();
  search.data.value = { locations: [] };
  vi.clearAllMocks();
});

describe("holding the vendor call back", () => {
  it("shows nothing and says why below two characters", async () => {
    const wrapper = render();
    await wrapper.find('[data-testid="search"]').setValue("L");
    await flushPromises();
    expect(wrapper.text()).toContain("at least two characters");
    expect(wrapper.find('[data-testid="results"]').exists()).toBe(false);
  });

  it("searches from two characters", async () => {
    search.data.value = { locations: [loves()] };
    const wrapper = render();
    await wrapper.find('[data-testid="search"]').setValue("LO");
    await flushPromises();
    expect(wrapper.find('[data-testid="results"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("LOVES 442");
  });
});

describe("choosing one", () => {
  it("emits the 6-digit id the override recipe needs", async () => {
    search.data.value = { locations: [loves()] };
    const wrapper = render();
    await wrapper.find('[data-testid="search"]').setValue("LOVES");
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().trim() === "Select")!.trigger("click");

    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect((emitted![0]![0] as EfsLocation).locId).toBe("442013");
  });

  it("collapses to a summary once chosen, so nothing can be picked twice by accident", () => {
    const wrapper = render(loves());
    expect(wrapper.find('[data-testid="search"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("LOVES 442");
    expect(wrapper.text()).toContain("442013");
  });

  it("lets the choice be undone", async () => {
    const wrapper = render(loves());
    await wrapper.findAll("button").find((b) => b.text().trim() === "Change")!.trigger("click");
    expect(wrapper.emitted("update:modelValue")![0]![0]).toBeNull();
  });
});
