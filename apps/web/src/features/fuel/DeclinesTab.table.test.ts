import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia } from "pinia";
import { defineComponent, h, ref } from "vue";

/**
 * D-US4 — the "Card assignments" drawer's table is drawn by `DataTable`. Shallow, as the coverage
 * suite next door mounts this tab, with DataTable itself left real and the drawer reduced to its
 * slot. The desktop breakpoint is stubbed because jsdom has no `matchMedia`.
 */
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});
const emptyQuery = vi.hoisted(() => () => ({ data: { value: { rows: [], total: 0 } }, isLoading: { value: false }, isError: { value: false }, error: { value: null }, refetch: () => {}, isFetching: { value: false } }));
vi.mock("./useEfsData", () => ({
  EFS_PAGE_SIZE: 20,
  useDeclinedTransactions: emptyQuery,
  useEfsFacets: () => ({ data: { value: undefined } }),
  useEfsRowCoverage: () => ({ data: { value: null } }),
}));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: { value: [{ id: "v1", unit_number: "654" }] } }),
}));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: { value: [] } }) }));
vi.mock("vue-router", async (importOriginal) => ({
  ...(({ routerKey, createRouter, createMemoryHistory }) => ({ routerKey, createRouter, createMemoryHistory }))(
    await importOriginal<typeof import("vue-router")>(),
  ),
  useRouter: () => ({ push: () => {} }),
}));
const cards = vi.hoisted(() => ({ none: false }));
vi.mock("@/composables/useCardAssignments", () => ({
  useCardAssignments: () => ({
    data: {
      value: cards.none ? [] : [
        { id: "a1", card_ref: "••1234", card_last4: "1234", vehicle_id: "v1", assignment_source: "learned", updated_at: null },
        { id: "a2", card_ref: "••5678", card_last4: "5678", vehicle_id: null, assignment_source: "manual", updated_at: null },
      ],
    },
  }),
  maskCardRef: (r: string) => r,
}));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: null })) }));

import DeclinesTab from "./DeclinesTab.vue";
import { DataTable } from "@silvicom/ui";
import type { FuelLogSharedFilters } from "./useFuelLogFilters";

const shared = () =>
  ({
    tab: ref("declines"), from: ref(undefined), to: ref(undefined), units: ref([]),
    setFrom: () => {}, setTo: () => {}, setUnits: () => {}, facet: () => ref(""), clear: () => {},
  }) as unknown as FuelLogSharedFilters;

// The drawer, open or not, reduced to its contents — only the card drawer's, so the decline
// drill-down (which reads a selected row) stays out of the way.
const SlideOver = defineComponent({
  props: { title: String },
  setup: (p, { slots }) => () => (p.title === "Card assignments" ? h("div", slots.default?.()) : null),
});

describe("card assignments drawer", () => {
  it("renders through DataTable with its columns and an assignment's row", () => {
    const w = mount(DeclinesTab, {
      shallow: true,
      props: { shared: shared() },
      global: { plugins: [VueQueryPlugin, createPinia()], stubs: { DataTable: false, SlideOver } },
    });
    const table = w.findAllComponents(DataTable).find((t) => t.find("th").text() === "Card");
    expect(table).toBeDefined();
    expect(table!.findAll("th").map((th) => th.text())).toEqual(["Card", "Assigned truck", "Source"]);
    const [learned, manual] = table!.findAll("tbody tr");
    expect(learned!.findAll("td").map((td) => td.text())).toEqual(["••1234", "654", "learned"]);
    // A card with no truck shows the table's own em dash, not a hand-written one.
    expect(manual!.findAll("td").map((td) => td.text())).toEqual(["••5678", "—", "manual"]);
  });

  /** The table owns its empty state (the sweep after US6b batch 3, 2026-10-14), not a paragraph in its place. */
  it("says no card has a truck yet in the table's own empty state", () => {
    cards.none = true;
    const w = mount(DeclinesTab, {
      shallow: true,
      props: { shared: shared() },
      global: { plugins: [VueQueryPlugin, createPinia()], stubs: { DataTable: false, SlideOver } },
    });
    cards.none = false;
    const table = w.findAllComponents(DataTable).find((t) => t.text().includes("No card has a truck yet."));
    expect(table).toBeDefined();
  });
});

// The decline drill-down alone, so its facts can be read without the card drawer beside them.
const DeclineDrawer = defineComponent({
  props: { title: String, open: Boolean },
  setup: (p, { slots }) => () => (p.title === "Declined attempt" && p.open ? h("div", slots.default?.()) : null),
});

describe("decline drill-down facts", () => {
  it("pairs each label with its value through FactList, with a dash and the reason when no driver is known (D-US6)", async () => {
    const w = mount(DeclinesTab, {
      shallow: true,
      props: { shared: shared() },
      global: { plugins: [VueQueryPlugin, createPinia()], stubs: { FactList: false, SlideOver: DeclineDrawer } },
    });
    (w.vm as unknown as { selectedRow: Record<string, unknown> }).selectedRow = {
      unit: "654", declined_at: "2026-10-01T12:00:00Z", state: "TX", error_code: "R3", error_description: null,
      policy_name: null, suspicion_level: "clear", suspicion_reasons: [], driver_name: null, driver_name_source: null,
      card_ref: "••1234", invoice: "", location_text: "Pilot 412", city: "Amarillo", import_id: "imp-9",
    };
    await w.vm.$nextTick();
    const list = w.get("[data-testid=decline-facts]");
    expect(list.findAll("dt").map((d) => d.text())).toEqual(["Driver", "Card #", "Invoice", "Location", "City", "State", "Import ID"]);
    const values = list.findAll("dd").map((d) => d.text());
    expect(values[0]).toMatch(/^—\s*EFS does not say who used the card/);
    expect(values.slice(1)).toEqual(["••1234", "—", "Pilot 412", "Amarillo", "TX", "imp-9"]);
  });

  /** The subject of the drawer is its heading, at the drawer's size (the two-size ruling), not bold text. */
  it("heads the drill-down with the unit as a heading", async () => {
    const w = mount(DeclinesTab, {
      shallow: true,
      props: { shared: shared() },
      global: { plugins: [VueQueryPlugin, createPinia()], stubs: { FactList: false, SlideOver: DeclineDrawer } },
    });
    (w.vm as unknown as { selectedRow: Record<string, unknown> }).selectedRow = {
      unit: "654", declined_at: "2026-10-01T12:00:00Z", state: "TX", error_code: "R3", error_description: null,
      policy_name: null, suspicion_level: "clear", suspicion_reasons: [], driver_name: null, driver_name_source: null,
      card_ref: "••1234", invoice: "", location_text: "Pilot 412", city: "Amarillo", import_id: "imp-9",
    };
    await w.vm.$nextTick();
    const heading = w.get("h3");
    expect(heading.text()).toBe("Unit 654");
    expect(heading.classes()).toEqual(expect.arrayContaining(["text-sm", "font-semibold"]));
  });
});
