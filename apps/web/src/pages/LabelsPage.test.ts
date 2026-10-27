import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const AVERY = {
  id: "avery-22805",
  name: "Avery 22805",
  perSheet: 24,
  material: "Polyester.",
  label: { width: 108, height: 108 },
  sheet: { width: 612, height: 792 },
};
const ROLL = {
  id: "roll-single",
  name: "Roll — 2\" × 2\" direct thermal (label printer)",
  perSheet: 1,
  material: "Direct-thermal paper.",
  label: { width: 144, height: 144 },
  sheet: { width: 144, height: 144 },
};
/** The stocks the API offers. Avery alone unless a test says otherwise — the run tests predate R6. */
let offered: Array<typeof AVERY> = [AVERY];

/** F3: which reads answer 500, and the Retry each failure must reach. */
const fail = { stock: false, assets: false, presets: false, faces: false };
const refetch = { stock: vi.fn(), assets: vi.fn(), presets: vi.fn() };

const facesMutate = vi.fn(async (_targets: LabelTarget[]) => ({ faces: [FACE], dropped: 0 }));
const fetchSheet = vi.fn(async () => "blob:sheet");

vi.mock("@/features/inventory/useLabels", () => ({
  useLabelPresetsQuery: () => ({
    isLoading: ref(false),
    isError: ref(fail.presets),
    isFetching: ref(false),
    refetch: refetch.presets,
    data: ref(fail.presets ? undefined : offered),
  }),
  useLabelFaces: () => ({
    mutateAsync: facesMutate,
    data: ref(fail.faces ? undefined : { faces: [FACE], dropped: 0 }),
    isError: ref(fail.faces),
    isPending: ref(false),
  }),
  fetchLabelSheet: fetchSheet,
}));

/** A stock line; the paging tests fill the shelves with more of them. */
const line = (partId: string, partNumber: string) => ({
  partId,
  locationId: BAY,
  partNumber,
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
});
let extraLines: ReturnType<typeof line>[] = [];
/** The filter the page last handed `useAssetsQuery` — the server page it asks for (D-US8). */
let assetsFilter: { value: { page: number; search?: string } } | null = null;
let assetsTotal = 1;

/** The filter the page last handed `useStockPageQuery` — the server page and search it asks for (F32). */
let stockFilter: { value: { page: number; search?: string } } | null = null;
/** What the server says the whole list holds; null = the lines given. */
let stockTotal: number | null = null;

vi.mock("@/features/inventory/useInventory", async () => {
  const { computed: c } = await import("vue");
  return {
    STOCK_PAGE_SIZE: 20,
    // The SERVER's page: the mock slices as the route does and never searches — searching is the
    // route's job now (F32), so a test that wants a search asks what the page SENT.
    useStockPageQuery: (filter: { value: { page: number; search?: string } }) => {
      stockFilter = filter;
      const all = () => [
        ...extraLines,
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
      ];
      return {
        isError: ref(fail.stock),
        isFetching: ref(false),
        refetch: refetch.stock,
        data: c(() =>
          fail.stock
            ? undefined
            : { lines: all().slice((filter.value.page - 1) * 20, filter.value.page * 20), total: stockTotal ?? all().length },
        ),
        isLoading: ref(false),
      };
    },
  };
});

vi.mock("@/features/inventory/useAssets", () => ({
  ASSETS_PAGE_SIZE: 50,
  useAssetsQuery: (filter: { value: { page: number; search?: string } }) => {
    assetsFilter = filter;
    return {
      isError: ref(fail.assets),
      refetch: refetch.assets,
      data: ref(fail.assets ? undefined : {
        assets: [{ id: ASSET, displayNo: "A-0412", name: "Cab tablet", assetTypeName: "Tablet", tagCode: null }],
        total: assetsTotal,
      }),
      isLoading: ref(false),
      isFetching: ref(false),
    };
  },
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
    props: { columns: null, rows: null, loading: null, error: null, retrying: null, rowKey: null, selectable: null, selected: null, embedded: Boolean },
    // The footer renders, so the pager the page puts there is the real one.
    template: "<div><slot name='footer' /></div>",
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
  extraLines = [];
  offered = [AVERY];
  // The repo's jsdom has no `localStorage` (useColorScheme.test.ts), so each test gets a fresh one.
  const kept = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
      removeItem: (k: string) => void kept.delete(k),
    },
    configurable: true,
    writable: true,
  });
  assetsTotal = 1;
  stockTotal = null;
  Object.assign(fail, { stock: false, assets: false, presets: false, faces: false });
  Object.values(refetch).forEach((f) => f.mockClear());
});

afterAll(() => Reflect.deleteProperty(globalThis, "localStorage"));

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

/**
 * D-US8: both lists page. The assets page through the SERVER — `/assets` answers fifty at a time, and
 * before this the table asked for page 1 with no pager, so asset 51 onward could never be ticked. The
 * shelves are one response and page as slices. The ticks outlive a page change.
 */
describe("paging the two lists", () => {
  const toAssets = async (w: Awaited<ReturnType<typeof render>>) => {
    w.findComponent({ name: "AppSegmentedControl" }).vm.$emit("update:modelValue", "assets");
    await flushPromises();
  };
  const pager = (w: Awaited<ReturnType<typeof render>>) => w.findComponent({ name: "TablePagination" });

  it("asks the server for the asset page the pager moves to, and counts from its total", async () => {
    assetsTotal = 120;
    const w = await render();
    await toAssets(w);
    expect(assetsFilter!.value.page).toBe(1);
    expect(pager(w).props()).toMatchObject({ total: 120, pageSize: 50 });

    pager(w).vm.$emit("update:page", 2);
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ page: "2" });
    expect(assetsFilter!.value.page).toBe(2);
  });

  it("sends a pasted search to the asset query, and a new search returns to page 1", async () => {
    assetsTotal = 120;
    const w = await render("/labels?search=cab");
    await toAssets(w);
    expect(assetsFilter!.value.search).toBe("cab");
    pager(w).vm.$emit("update:page", 2);
    await flushPromises();
    w.findComponent({ name: "FilterBar" }).vm.$emit("update:search", "tab");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ search: "tab" });
    expect(assetsFilter!.value).toMatchObject({ page: 1, search: "tab" });
  });

  it("keeps the ticks when the page changes", async () => {
    assetsTotal = 120;
    const w = await render();
    await toAssets(w);
    const ticked = new Set([`asset:${ASSET}`]);
    w.findComponent({ name: "DataTable" }).vm.$emit("update:selected", ticked);
    await flushPromises();
    pager(w).vm.$emit("update:page", 2);
    await flushPromises();
    expect(w.findComponent({ name: "DataTable" }).props("selected")).toEqual(ticked);
  });

  it("a pasted ?page=2 asks the server for shelves 21–40, and a search goes to the server from page 1", async () => {
    extraLines = Array.from({ length: 44 }, (_, i) =>
      line(`aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, "0")}`, `P-${String(i + 1).padStart(2, "0")}`),
    );
    const w = await render("/labels?page=2");
    const parts = () => (w.findComponent({ name: "DataTable" }).props("rows") as Array<{ partNumber: string }>).map((r) => r.partNumber);
    expect(stockFilter!.value).toMatchObject({ page: 2 });
    expect(parts()).toEqual(extraLines.slice(20, 40).map((l) => l.partNumber));
    w.findComponent({ name: "FilterBar" }).vm.$emit("update:search", "P-");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ search: "P-" });
    expect(stockFilter!.value).toEqual({ page: 1, search: "P-" });
  });

  // F32 (US6b): the shelves were one 200-line response searched here, so line 201 could not be reached
  // and a search could not find it. The page draws what the server sent and counts what it says.
  it("draws the server's page as it came, and pages to the server's total past 200", async () => {
    stockTotal = 250;
    const w = await render("/labels?search=north");
    expect(stockFilter!.value).toEqual({ page: 1, search: "north" });
    // "north" is in none of the mock line's fields: the server's answer is shown as sent, and a page
    // that filtered it again in the browser would draw nothing here.
    const rows = w.findComponent({ name: "DataTable" }).props("rows") as Array<{ partNumber: string }>;
    expect(rows.map((r) => r.partNumber)).toEqual(["P-100"]);
    expect(pager(w).props()).toMatchObject({ total: 250, pageSize: 20 });
  });

  it("switching lists returns to page 1", async () => {
    extraLines = Array.from({ length: 44 }, (_, i) =>
      line(`aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, "0")}`, `P-${i + 1}`),
    );
    const w = await render("/labels?page=2");
    await toAssets(w);
    expect(router.currentRoute.value.query).toEqual({});
    expect(assetsFilter!.value.page).toBe(1);
  });
});

/**
 * F3 (US6b): a failed read is not an empty shelf. Before, a failed stock read said "Nothing on the
 * shelves yet", a failed presets read left an empty white card, and a failed faces read was a toast
 * that faded beside a hint telling the reader to tick rows they had already ticked.
 */
describe("a failed read", () => {
  const retry = (w: Awaited<ReturnType<typeof render>>) => w.findAll("button").find((b) => b.text() === "Retry")!;

  it("hands the shelves table its failure, and its Retry asks for the stock again", async () => {
    fail.stock = true;
    const w = await render();
    const table = w.findComponent({ name: "DataTable" });
    expect(table.props("error")).toBe("Could not load the shelves.");
    table.vm.$emit("retry");
    expect(refetch.stock).toHaveBeenCalledTimes(1);
  });

  it("hands the assets table its failure, and its Retry asks for the assets again", async () => {
    fail.assets = true;
    const w = await render(`/labels?asset=${ASSET}`);
    const table = w.findComponent({ name: "DataTable" });
    expect(table.props("error")).toBe("Could not load the assets.");
    table.vm.$emit("retry");
    expect(refetch.assets).toHaveBeenCalledTimes(1);
  });

  it("says the label stock could not be loaded instead of drawing an empty card", async () => {
    fail.presets = true;
    const w = await render();
    expect(w.text()).toContain("Could not load the label stock.");
    await retry(w).trigger("click");
    expect(refetch.presets).toHaveBeenCalledTimes(1);
  });

  it("says the labels could not be read where the preview would be, and Retry reads them again", async () => {
    fail.faces = true;
    const w = await render(`/labels?asset=${ASSET}`);
    expect(w.text()).toContain("Could not read those labels.");
    expect(w.text()).not.toContain("Tick what needs a label");
    expect(w.findComponent({ name: "LabelSheetPreview" }).exists()).toBe(false);
    const before = facesMutate.mock.calls.length;
    await retry(w).trigger("click");
    expect(facesMutate.mock.calls.length).toBe(before + 1);
  });

  it("with nothing ticked shows the hint, not a preview of an earlier selection", async () => {
    const w = await render();
    expect(w.text()).toContain("Tick what needs a label");
    expect(w.findComponent({ name: "LabelSheetPreview" }).exists()).toBe(false);
  });
});

/**
 * R6 (DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md §5): the shop's printer is a 2" roll, and a screen that
 * opened on Avery every visit sent a Letter page to it whenever somebody forgot to switch.
 */
describe("which stock the screen opens on", () => {
  const controls = (w: Awaited<ReturnType<typeof render>>) => w.findComponent({ name: "LabelStockControls" });

  it("opens on the roll when this browser has never chosen", async () => {
    offered = [AVERY, ROLL];
    const w = await render();
    expect(controls(w).props("presetId")).toBe("roll-single");
  });

  it("opens on the stock this browser last chose, and remembers a new choice", async () => {
    offered = [AVERY, ROLL];
    localStorage.setItem("silvicom:labels:preset", "avery-22805");
    const w = await render();
    expect(controls(w).props("presetId")).toBe("avery-22805");

    controls(w).vm.$emit("update:presetId", "roll-single");
    await flushPromises();
    expect(controls(w).props("presetId")).toBe("roll-single");
    expect(localStorage.getItem("silvicom:labels:preset")).toBe("roll-single");
  });

  /** An id kept from an older release prints as a 422 at the end of the flow if it is trusted. */
  it("ignores a remembered stock the server no longer offers", async () => {
    offered = [AVERY, ROLL];
    localStorage.setItem("silvicom:labels:preset", "avery-gone");
    const w = await render();
    expect(controls(w).props("presetId")).toBe("roll-single");
  });

  it("puts the start position back to 1 when the new stock has no such position", async () => {
    offered = [AVERY, ROLL];
    localStorage.setItem("silvicom:labels:preset", "avery-22805");
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const w = await render(`/labels?asset=${ASSET}`);
    controls(w).vm.$emit("update:startPosition", 20);
    await flushPromises();
    controls(w).vm.$emit("update:presetId", "roll-single");
    await flushPromises();

    await w.findAll("button").find((b) => b.text().startsWith("Print"))!.trigger("click");
    await flushPromises();
    expect(fetchSheet).toHaveBeenCalledWith(
      [{ kind: "asset", assetId: ASSET }],
      { presetId: "roll-single", startPosition: 1, nudgeX: 0, nudgeY: 0 },
    );
    open.mockRestore();
  });
});
