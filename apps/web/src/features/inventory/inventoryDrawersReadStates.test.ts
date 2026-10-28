import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, ref } from "vue";

/**
 * The shop's two configuration drawers answer a read in three ways — loading, failure with Retry,
 * empty — and never treat the first two as the third (the sweep after US6b batch 3, 2026-10-14).
 *
 * Before: Stock locations said "No places yet. Add the shop itself first" when its read FAILED,
 * and Asset kinds offered "Set it up" — adopting the standard kit, which OVERWRITES the fleet's kit
 * rules — while its read was in flight and after it failed. The desktop breakpoint is stubbed
 * because jsdom has no `matchMedia` and DataTable would render cards.
 */
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

const { read, answer, mutation } = await vi.hoisted(async () => {
  const { ref } = await import("vue");
  const read = { state: "ok" as "ok" | "loading" | "failed" | "empty", refetches: 0 };
  return {
    read,
    answer: <T>(rows: T[]) => ({
      data: ref(read.state === "ok" ? rows : read.state === "empty" ? [] : undefined),
      isLoading: ref(read.state === "loading"),
      isError: ref(read.state === "failed"),
      isFetching: ref(false),
      refetch: () => { read.refetches++; },
    }),
    mutation: () => ({ isPending: ref(false), mutateAsync: () => Promise.resolve() }),
  };
});

vi.mock("./useInventory", () => ({
  useLocationsQuery: () =>
    answer([
      { id: "l1", name: "Main shop", code: "MAIN", address: null, active: true },
      { id: "l2", name: "North yard", code: "YARD", address: "1 Yard Rd", active: false },
    ]),
  useCreateLocation: mutation,
  useUpdateLocation: mutation,
}));
vi.mock("./useAssets", () => ({
  useAssetTypesQuery: () => answer([{ id: "t1", name: "Tablet", category: "Electronics", serialized: true }]),
  useCreateAssetType: mutation,
  useUpdateAssetType: mutation,
  useAdoptStandardKit: mutation,
}));

import LocationsDrawer from "./LocationsDrawer.vue";
import AssetTypesDrawer from "./AssetTypesDrawer.vue";

// The drawer reduced to its body: the states live there, and the footer's buttons are not the subject.
const SlideOver = defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) });
const render = (c: typeof LocationsDrawer | typeof AssetTypesDrawer) =>
  mount(c, { props: { open: true }, attachTo: document.body, global: { stubs: { SlideOver } } });

beforeEach(() => {
  setActivePinia(createPinia());
  read.state = "ok";
  read.refetches = 0;
});

describe("Stock locations", () => {
  it("says the read failed, with Retry, instead of telling the shop to add its first location", async () => {
    read.state = "failed";
    const w = render(LocationsDrawer);
    expect(w.text()).toContain("Could not load the places.");
    expect(w.text()).not.toContain("No locations yet");
    await w.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    expect(read.refetches).toBe(1);
    w.unmount();
  });

  it("says it is loading, and only an answered empty read says there are none", () => {
    read.state = "loading";
    const loading = render(LocationsDrawer);
    expect(loading.text()).toContain("Loading the locations…");
    expect(loading.text()).not.toContain("No locations yet");
    loading.unmount();
    read.state = "empty";
    const empty = render(LocationsDrawer);
    expect(empty.text()).toContain("No places yet. Add the shop itself first");
    empty.unmount();
  });

  it("lists the locations as a table, with Edit and Close or Reopen in each row's menu", async () => {
    const w = render(LocationsDrawer);
    expect(w.findAll("th").map((th) => th.text()).slice(0, 3)).toEqual(["Location", "Address", "State"]);
    const [main, yard] = w.findAll("tbody tr");
    expect(main!.text()).toContain("Main shop");
    expect(yard!.text()).toContain("Closed");
    expect(w.findAll("button").map((b) => b.text())).not.toContain("Edit");
    await w.get('[aria-label="Actions for Main shop"]').trigger("click");
    const items = [...document.querySelectorAll<HTMLElement>("button.kebab-item")];
    expect(items.map((el) => el.textContent!.trim())).toEqual(["Edit", "Close"]);
    expect(items[1]!.classList.contains("kebab-item-danger")).toBe(true);
    w.unmount();
  });
});

describe("Asset kinds", () => {
  it("never offers the standard kit while its read is in flight or after it failed", () => {
    for (const state of ["loading", "failed"] as const) {
      read.state = state;
      const w = render(AssetTypesDrawer);
      expect(w.findAll("button").map((b) => b.text())).not.toContain("Set it up");
      expect(w.text()).toContain(state === "loading" ? "Loading the types…" : "Could not load the types.");
      w.unmount();
    }
  });

  it("offers it on an answered empty read, and not once a kind exists", () => {
    read.state = "empty";
    const empty = render(AssetTypesDrawer);
    expect(empty.findAll("button").map((b) => b.text())).toContain("Set it up");
    empty.unmount();
    read.state = "ok";
    const some = render(AssetTypesDrawer);
    expect(some.findAll("button").map((b) => b.text())).not.toContain("Set it up");
    expect(some.text()).toContain("Tablet");
    some.unmount();
  });
});
