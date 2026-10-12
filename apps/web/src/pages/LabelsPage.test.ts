import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { ref } from "vue";
import type { LabelFaceDto, LabelTarget } from "@silvicom/shared";

/**
 * The label screen (INVENTORY-PLAN.md I10 PR 2).
 *
 * ── WHAT IS ONLY TRUE HERE ────────────────────────────────────────────────────────────────────
 * `labelSheet()` is pinned in `@silvicom/qr`, the API's own suites own issuance and the PDF. What
 * this page decides, and nothing else would catch:
 *
 *   · **a stock line survives the round trip through a table row key.** A shelf has no id — it is
 *     one part at one location — so the key is the pair joined by a separator, and the target has to
 *     come back out of it as the same pair. Get it wrong and the run asks for labels for something
 *     else, or for nothing, and the sheet prints anyway;
 *   · **the two sources cannot be mixed by accident.** Switching Shelves↔Assets clears the ticks,
 *     because a key from one table read as the other's produces a target the API will silently drop;
 *   · **the printed run is the ticked set**, in the shape the contract wants;
 *   · **one asset id in the query preselects it**, which is the detail page's "print this one".
 */

const PART = "11111111-1111-4111-8111-111111111111";
const BAY = "22222222-2222-4222-8222-222222222222";
const ASSET = "33333333-3333-4333-8333-333333333333";

const FACE: LabelFaceDto = {
  target: { kind: "asset", assetId: ASSET },
  payload: "SIL1:AST:7K3M9P",
  code: "A-0412",
  lines: ["Cab tablet"],
};

const facesMutate = vi.fn(async (_targets: LabelTarget[]) => ({ faces: [FACE], dropped: 0 }));
const fetchSheet = vi.fn(async () => "blob:sheet");

vi.mock("@/features/inventory/useLabels", () => ({
  useLabelPresetsQuery: () => ({
    data: ref([
      {
        id: "avery-22805",
        name: "Avery 22805",
        perSheet: 24,
        material: "Polyester.",
        label: { width: 108, height: 108 },
        sheet: { width: 612, height: 792 },
      },
    ]),
  }),
  useLabelFaces: () => ({ mutateAsync: facesMutate, data: ref({ faces: [FACE], dropped: 0 }) }),
  fetchLabelSheet: fetchSheet,
}));

vi.mock("@/features/inventory/useInventory", () => ({
  useStockQuery: () => ({
    data: ref({
      lines: [
        {
          partId: PART,
          locationId: BAY,
          partNumber: "P-100",
          partDescription: "Oil filter",
          locationName: "Bay A",
          unitOfMeasure: "each",
          quantityOnHand: 11,
          reorderPoint: null,
          reorderQuantity: null,
          aisle: null,
          row: null,
          bin: null,
          tagCode: null,
          lastCost: null,
          active: true,
        },
      ],
      total: 1,
    }),
    isLoading: ref(false),
  }),
}));

vi.mock("@/features/inventory/useAssets", () => ({
  useAssetsQuery: () => ({
    data: ref({
      assets: [{ id: ASSET, displayNo: "A-0412", name: "Cab tablet", assetTypeName: "Tablet", tagCode: null }],
      total: 1,
    }),
    isLoading: ref(false),
  }),
}));

/**
 * A real (memory) router: the search lives in the URL (D-US2) and is written with `router.replace`,
 * which a hand-rolled `useRoute` mock cannot answer. `render` opens the page at `url`.
 */
let router: Router;

const toast = { error: vi.fn(), push: vi.fn(), success: vi.fn() };
vi.mock("@/stores/toast", () => ({ useToastStore: () => toast }));

const LabelsPage = (await import("@/pages/LabelsPage.vue")).default;

/** Stubs that expose what the page handed down, without rendering a whole sheet into jsdom. */
const stubs = {
  PageHeader: { template: "<div><slot name='actions' /></div>" },
  FilterBar: {
    name: "FilterBar",
    template: "<div><slot name='filters' /><slot name='more' /><slot name='actions' /></div>",
    props: { search: null, count: null, countLabel: null, searchPlaceholder: null, embedded: Boolean, activeCount: null },
  },
  DataWorkspace: { name: "DataWorkspace", template: "<section data-testid='data-workspace'><slot /></section>" },
  AppSegmentedControl: {
    name: "AppSegmentedControl",
    props: ["modelValue", "options", "label"],
    template: "<div />",
  },
  DataTable: {
    name: "DataTable",
    props: { columns: null, rows: null, loading: null, rowKey: null, selectable: null, selected: null, embedded: Boolean },
    template: "<div />",
  },
  LabelSheetPreview: { name: "LabelSheetPreview", props: ["faces", "presetId", "startPosition", "nudgeX", "nudgeY"], template: "<div />" },
  LabelStockControls: { name: "LabelStockControls", props: ["presets", "presetId", "startPosition", "nudgeX", "nudgeY"], template: "<div />" },
};

async function render(url = "/labels") {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/labels", component: { template: "<div/>" } }] });
  await router.push(url);
  await router.isReady();
  const w = mount(LabelsPage, { global: { plugins: [router], stubs } });
  await flushPromises();
  return w;
}

beforeEach(() => {
  facesMutate.mockClear();
  fetchSheet.mockClear();
});

describe("picking what to label", () => {
  it("keeps the source control and picker table in one embedded data workspace", async () => {
    const wrapper = await render();
    const workspace = wrapper.get('[data-testid="data-workspace"]');

    expect(workspace.findComponent({ name: "AppSegmentedControl" }).exists()).toBe(true);
    expect(workspace.findComponent({ name: "FilterBar" }).props("embedded")).toBe(true);
    expect(workspace.findComponent({ name: "DataTable" }).props("embedded")).toBe(true);
  });

  /**
   * ⚠ The assertion this file exists for. A shelf has no id of its own, so the table's row key is
   * `stock:<part>:<location>` and the target has to come back out of that string as the same pair.
   * A separator mistake here produces a run for the wrong shelf — or for none — and the sheet prints
   * regardless, because every layer below this one is happy with whatever ids it is given.
   */
  it("turns a shelf's row key back into the pair that identifies it", async () => {
    const wrapper = await render();
    const table = wrapper.findComponent({ name: "DataTable" });
    const key = (table.props("rowKey") as (r: Record<string, unknown>) => string)({
      partId: PART,
      locationId: BAY,
    });

    table.vm.$emit("update:selected", new Set([key]));
    await wrapper.vm.$nextTick();

    expect(facesMutate).toHaveBeenCalledWith([{ kind: "stock", partId: PART, locationId: BAY }]);
  });

  /**
   * A key minted for one table and read as the other's yields a target the API silently drops — the
   * run would come back one label short with nothing on screen saying why. Clearing on the switch is
   * what makes that unreachable.
   */
  it("clears the ticks when the source changes", async () => {
    const wrapper = await render();
    const table = wrapper.findComponent({ name: "DataTable" });
    const key = (table.props("rowKey") as (r: Record<string, unknown>) => string)({
      partId: PART,
      locationId: BAY,
    });
    table.vm.$emit("update:selected", new Set([key]));
    await wrapper.vm.$nextTick();

    wrapper.findComponent({ name: "AppSegmentedControl" }).vm.$emit("update:modelValue", "assets");
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent({ name: "DataTable" }).props("selected")).toEqual(new Set());
  });

  /** The detail page's "print this label" — one id in the URL is not a workaround. */
  it("preselects an asset named in the query", async () => {
    const wrapper = await render(`/labels?asset=${ASSET}`);
    await wrapper.vm.$nextTick();

    expect(facesMutate).toHaveBeenCalledWith([{ kind: "asset", assetId: ASSET }]);
  });

  /**
   * "What to label" switches between two lists rather than narrowing one, so only the search counts
   * as a filter and clearing it leaves the switch on Assets.
   */
  it("counts the search as the only filter, and clearing empties it without switching lists", async () => {
    const wrapper = await render();
    wrapper.findComponent({ name: "AppSegmentedControl" }).vm.$emit("update:modelValue", "assets");
    await wrapper.vm.$nextTick();
    const bar = () => wrapper.findComponent({ name: "FilterBar" });
    expect(bar().props("activeCount")).toBe(0);

    bar().vm.$emit("update:search", "jack");
    await wrapper.vm.$nextTick();
    expect(bar().props("activeCount")).toBe(1);

    bar().vm.$emit("clear-all");
    await wrapper.vm.$nextTick();
    expect(bar().props("search")).toBe("");
    expect(bar().props("activeCount")).toBe(0);
    expect(wrapper.findComponent({ name: "AppSegmentedControl" }).props("modelValue")).toBe("assets");
  });
});

// ── D-US2: the list's one filter lives in the URL; the switch, the ticks and the sheet do not ──
describe("the search in the URL", () => {
  it("reads a pasted search back into the bar", async () => {
    const wrapper = await render("/labels?search=filter");
    expect(wrapper.findComponent({ name: "FilterBar" }).props("search")).toBe("filter");
    expect(wrapper.findComponent({ name: "FilterBar" }).props("activeCount")).toBe(1);
  });

  it("writes a typed search, and Clear filters takes it out again", async () => {
    const wrapper = await render();
    const bar = () => wrapper.findComponent({ name: "FilterBar" });
    bar().vm.$emit("update:search", "jack");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ search: "jack" });
    bar().vm.$emit("clear-all");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("keeps the ticks of a 'print this one' link while the reader searches", async () => {
    const wrapper = await render(`/labels?asset=${ASSET}`);
    const table = () => wrapper.findComponent({ name: "DataTable" });
    const ticked = new Set([`asset:${ASSET}`, "asset:44444444-4444-4444-8444-444444444444"]);
    table().vm.$emit("update:selected", ticked);
    await flushPromises();
    wrapper.findComponent({ name: "FilterBar" }).vm.$emit("update:search", "cab");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ asset: ASSET, search: "cab" });
    expect(table().props("selected")).toEqual(ticked);
  });
});

describe("printing", () => {
  it("sends the ticked run with the chosen stock, and opens the sheet", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const wrapper = await render();
    const table = wrapper.findComponent({ name: "DataTable" });
    const key = (table.props("rowKey") as (r: Record<string, unknown>) => string)({
      partId: PART,
      locationId: BAY,
    });
    table.vm.$emit("update:selected", new Set([key]));
    await wrapper.vm.$nextTick();

    await wrapper.findAll("button").find((b) => b.text().startsWith("Print"))!.trigger("click");
    await wrapper.vm.$nextTick();

    expect(fetchSheet).toHaveBeenCalledWith(
      [{ kind: "stock", partId: PART, locationId: BAY }],
      { presetId: "avery-22805", startPosition: 1, nudgeX: 0, nudgeY: 0 },
    );
    expect(open).toHaveBeenCalledWith("blob:sheet", "_blank", "noopener");
    open.mockRestore();
  });

  it("cannot print an empty run", async () => {
    const wrapper = await render();
    const button = wrapper.findAll("button").find((b) => b.text().startsWith("Print"))!;
    expect(button.attributes("disabled")).toBeDefined();
    expect(fetchSheet).not.toHaveBeenCalled();
  });
});
