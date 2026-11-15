import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import DataTable, { type DataTableColumn } from "./DataTable.vue";
import DataWorkspace from "./DataWorkspace.vue";
import FilterBar from "./FilterBar.vue";
import { provideTouchTargets } from "../touchTargets";

/**
 * The three-fact card (DESIGN-SYSTEM-CONTRACT.md §9 rule 3, Maintenance M4). A marked table's card is
 * the identifier, one sentence and one date or amount — nothing else — and the card opens the row.
 * Under the touch floor the cards are drawn at any width, because a tablet in a bay is above `md`.
 */
enableAutoUnmount(afterEach);

function setViewport(wide: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: wide && query.includes("min-width"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const MARKED: DataTableColumn[] = [
  { key: "unit", label: "Number", card: "title" },
  { key: "why", label: "Needs", card: "sentence" },
  { key: "due", label: "Due", card: "meta" },
  { key: "make", label: "Make", card: "none" },
  { key: "plate", label: "Plate" },
];
const ROWS = [{ id: "r1", unit: "654", why: "2 open defects", due: "11/10/2026", make: "Volvo", plate: "P 483" }];

function mountTable(
  opts: { touch?: boolean; columns?: DataTableColumn[]; withLink?: boolean; selectable?: boolean } = {},
) {
  const Host = defineComponent({
    emits: ["row-click"],
    setup(_, { emit }) {
      if (opts.touch) provideTouchTargets();
      return () =>
        h(
          DataTable,
          {
            columns: opts.columns ?? MARKED,
            rows: ROWS,
            selectable: opts.selectable ?? false,
            selected: new Set<string>(),
            onRowClick: (row: unknown) => emit("row-click", row),
          },
          {
            ...(opts.withLink ? { "cell-unit": ({ row }: { row: (typeof ROWS)[number] }) => h("a", { href: `/u/${row.id}` }, row.unit) } : {}),
            actions: () => h("button", { type: "button", class: "kebab" }, "⋮"),
          },
        );
    },
  });
  return mount(Host, { attachTo: document.body });
}

describe("the three-fact card", () => {
  it("shows the title, the sentence and the meta, and no other column", () => {
    setViewport(false);
    const text = mountTable().text();
    expect(text).toContain("654");
    expect(text).toContain("2 open defects");
    expect(text).toContain("11/10/2026");
    expect(text).not.toContain("Volvo");
    expect(text).not.toContain("P 483");
    // No label/value grid: a fact needs no label, which is the line a card used to spend on each.
    expect(mountTable().find("dl").exists()).toBe(false);
  });

  it("stretches the title's link over the card, and keeps the row's menu above the stretch", () => {
    setViewport(false);
    const w = mountTable({ withLink: true });
    const title = w.find("a").element.parentElement!;
    expect(title.className).toContain("[&_a]:after:inset-0");
    expect(w.find("li").classes()).toContain("relative");
    expect(w.find(".kebab").element.parentElement!.className).toContain("[&_button]:z-raised");
  });

  it("opens the row from a tap anywhere on a card, but not from its menu", async () => {
    setViewport(false);
    const w = mountTable();
    await w.find("li").trigger("click");
    expect(w.emitted("row-click")).toHaveLength(1);
    await w.find(".kebab").trigger("click");
    expect(w.emitted("row-click")).toHaveLength(1);
  });

  it("draws cards at a tablet's width under the touch floor, and the table at the desk", () => {
    setViewport(true);
    expect(mountTable({ touch: true }).find("table").exists()).toBe(false);
    expect(mountTable({ touch: true }).text()).toContain("2 open defects");
    expect(mountTable({ touch: false }).find("table").exists()).toBe(true);
  });

  it("derives a card for a table whose page has marked nothing", () => {
    setViewport(false);
    const unmarked = MARKED.map(({ card: _card, ...col }) => col);
    const w = mountTable({ columns: unmarked });
    expect(w.find("dl").exists()).toBe(true);
    expect(w.text()).toContain("Volvo");
  });

  /*
   * The full card is what every page that marks no facts renders on a phone — Fuel Cards, Fills,
   * Loads and a dozen more. It used to swallow the tap that opens the row at a desk (2026-11-02).
   */
  it("opens the row from a tap on the full card too, but not from its menu or its checkbox", async () => {
    setViewport(false);
    const unmarked = MARKED.map(({ card: _card, ...col }) => col);
    const w = mountTable({ columns: unmarked, selectable: true });
    expect(w.find("dl").exists()).toBe(true);
    await w.find("li").trigger("click");
    expect(w.emitted("row-click")).toEqual([[ROWS[0]]]);
    await w.find(".kebab").trigger("click");
    await w.find('input[type="checkbox"]').trigger("click");
    expect(w.emitted("row-click")).toHaveLength(1);
  });
});

/**
 * The one anatomy (SMALL-SCREENS-PLAN.md D-SM1…D-SM6, 2026-11-14). The owner's audit measured the
 * card these replace: twelve stacked fields a driver, a sixth figure alone on its own line, and rows
 * with no edge between them.
 */
const WIDE: DataTableColumn[] = [
  { key: "unit", label: "Unit" },
  { key: "odometer", label: "Odometer", numeric: true },
  { key: "miles", label: "Miles", numeric: true },
  { key: "gallons", label: "Gallons", numeric: true },
  { key: "price", label: "Price", numeric: true },
  { key: "driver", label: "Driver" },
  { key: "status", label: "Status" },
];
const WIDE_ROW = { id: "f1", unit: "T-101", odometer: 196728, miles: 695, gallons: 105, price: 3.799, driver: "Marcus Reyes", status: "Clear" };

function mountWide(opts: { columns?: DataTableColumn[]; embedded?: boolean; workspace?: boolean; rows?: unknown[] } = {}) {
  const Host = defineComponent({
    emits: ["row-click"],
    setup(_, { emit }) {
      const table = () =>
        h(DataTable, {
          columns: opts.columns ?? WIDE,
          rows: (opts.rows ?? [WIDE_ROW]) as (typeof WIDE_ROW)[],
          embedded: opts.embedded ?? false,
          onRowClick: (row: unknown) => emit("row-click", row),
        });
      return () =>
        opts.workspace ? h(DataWorkspace, null, { default: () => [h(FilterBar, { embedded: true, count: 1 }), table()] }) : table();
    },
  });
  return mount(Host, { attachTo: document.body });
}

describe("the record card", () => {
  it("draws three figures and folds the rest away, on a table that marked nothing", () => {
    setViewport(false);
    const w = mountWide();
    expect(w.findAll("[data-card-figures] dt").map((dt) => dt.text())).toEqual(["Odometer", "Miles", "Gallons"]);
    expect(w.findAll("[data-card-details] dt").map((dt) => dt.text())).toEqual(["Price", "Driver"]);
    // The status is on the top line, in neither grid.
    expect(w.text()).toContain("Clear");
    expect(w.findAll("dt").map((dt) => dt.text())).not.toContain("Status");
  });

  it("keeps the folded details in the document, hidden, and says what is in them", () => {
    setViewport(false);
    const w = mountWide();
    const details = w.get("[data-card-details]");
    expect(details.attributes("hidden")).toBeDefined();
    expect(details.text()).toContain("Marcus Reyes");
    const toggle = w.get("[data-card-details-toggle]");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(toggle.attributes("aria-controls")).toBe(details.attributes("id"));
    expect(toggle.text()).toBe("Price, Driver");
  });

  it("opens the details from their own button without opening the row", async () => {
    setViewport(false);
    const w = mountWide();
    await w.get("[data-card-details-toggle]").trigger("click");
    expect(w.get("[data-card-details]").attributes("hidden")).toBeUndefined();
    expect(w.get("[data-card-details-toggle]").attributes("aria-expanded")).toBe("true");
    expect(w.get("[data-card-details-toggle]").text()).toBe("Hide details");
    expect(w.emitted("row-click")).toBeUndefined();
  });

  it("reads a page's own marks instead of its column order, and holds a fourth figure back", () => {
    setViewport(false);
    const marked: DataTableColumn[] = [
      { key: "unit", label: "Unit", card: "title" },
      { key: "odometer", label: "Odometer", card: "detail" },
      { key: "miles", label: "Miles", card: "figure" },
      { key: "gallons", label: "Gallons", card: "figure" },
      { key: "price", label: "Price", card: "figure" },
      { key: "driver", label: "Driver", card: "figure" },
      { key: "status", label: "Status", card: "status" },
    ];
    const w = mountWide({ columns: marked });
    expect(w.findAll("[data-card-figures] dt").map((dt) => dt.text())).toEqual(["Miles", "Gallons", "Price"]);
    expect(w.findAll("[data-card-details] dt").map((dt) => dt.text())).toEqual(["Driver", "Odometer"]);
    expect(w.findAll("dt").map((dt) => dt.text())).not.toContain("Status");
    expect(w.text()).toContain("Clear");
  });

  it("gives each row its own card when the table owns its surface, and takes the outer one away", () => {
    setViewport(false);
    const w = mountWide();
    const card = w.get("[data-card]");
    expect(card.element.tagName).toBe("LI");
    expect(card.classes()).toContain("ring-1");
    // The table's own card is still the root — flat, so the row cards are not a card inside a card.
    expect(w.element.className).not.toContain("ring-1");
    expect(w.element.className).not.toContain("overflow-hidden");
  });

  it("keeps flat divided rows for a table embedded in somebody else's card", () => {
    setViewport(false);
    const w = mountWide({ embedded: true });
    expect(w.get("[data-card]").classes()).not.toContain("ring-1");
    expect(w.get("ul").classes()).toContain("divide-y");
  });

  it("boxes the cards of a table embedded in a workspace, and marks the list so the rest gets a surface", async () => {
    setViewport(false);
    const w = mountWide({ embedded: true, workspace: true });
    // The table reports from its own setup, a tick after the workspace first rendered around it.
    await nextTick();
    expect(w.get("[data-card]").classes()).toContain("ring-1");
    // The workspace is no longer the surface…
    expect(w.get("section").classes()).not.toContain("ring-1");
    expect(w.get("section").classes()).not.toContain("divide-y");
    // …and says so, with the card list marked: `.workspace-cards` gives a surface to every child that
    // is not, or does not hold, `[data-card-list]` (the toolbar here). CSS, so the browser pass sees it.
    expect(w.get("section").classes()).toContain("workspace-cards");
    const [toolbar, list] = [...w.get("section").element.children];
    expect(toolbar!.hasAttribute("data-card-list")).toBe(false);
    expect(list!.hasAttribute("data-card-list")).toBe(true);
  });

  it("leaves the workspace one surface at a desk, and while the list has nothing to draw", async () => {
    setViewport(true);
    const desk = mountWide({ embedded: true, workspace: true });
    await nextTick();
    expect(desk.get("section").classes()).toContain("ring-1");
    expect(desk.get("section").classes()).not.toContain("workspace-cards");
    expect(desk.find("[data-card-list]").exists()).toBe(false);
    setViewport(false);
    const empty = mountWide({ embedded: true, workspace: true, rows: [] });
    await nextTick();
    expect(empty.get("section").classes()).toContain("ring-1");
  });
});

/**
 * The context line's blank parts (SMALL-SCREENS-PLAN.md, 2026-11-15). A parked driver read "— · —":
 * a part that prints only a dash is not drawn, judged from what the page's cell printed.
 */
describe("a context part that says nothing", () => {
  const COLS: DataTableColumn[] = [
    { key: "unit", label: "Number", card: "title" },
    { key: "driver", label: "Driver", card: "sentence" },
    { key: "truck", label: "Truck", card: "sentence" },
    { key: "place", label: "Position", card: "sentence" },
  ];
  type Row = { id: string; unit: string | null; driver: string | null; truck: string | null; place: string | null };
  const cards = (rows: Row[], slots: Record<string, (p: { row: Row }) => unknown> = {}) => {
    setViewport(false);
    // `as never`: the mount helper types a scoped slot's argument as `any`-keyed props, not this row.
    return mount(DataTable, { props: { columns: COLS, rows }, slots: slots as never, attachTo: document.body });
  };
  const shown = (w: ReturnType<typeof cards>, i = 0) =>
    w.findAll("[data-context-line]")[i]!.findAll("[data-context-part]").filter((p) => !(p.element as HTMLElement).hidden).map((p) => p.text());

  it("drops out of the line, wherever it stands, and leaves the parts that say something", () => {
    const w = cards([
      { id: "a", unit: "654", driver: "ANN LEE", truck: null, place: "Reno, NV" },
      { id: "b", unit: "655", driver: null, truck: "733", place: null },
    ]);
    expect(shown(w, 0)).toEqual(["ANN LEE", "Reno, NV"]);
    expect(shown(w, 1)).toEqual(["733"]);
  });

  it("is judged from what the cell printed — a cell that words a missing value is kept, one that prints a dash is not", () => {
    const w = cards([{ id: "a", unit: "654", driver: null, truck: "733", place: "Reno, NV" }], {
      "cell-driver": ({ row }) => h("span", row.driver ?? "No driver"),
      "cell-place": () => h("span", { class: "text-ink-tertiary" }, "—"),
    });
    expect(shown(w)).toEqual(["No driver", "733"]);
  });

  it("keeps every part in the document, hidden, so a page test and find-in-page still read the card", () => {
    const w = cards([{ id: "a", unit: "654", driver: null, truck: null, place: null }]);
    expect(w.findAll("[data-context-part]")).toHaveLength(3);
    expect(shown(w)).toEqual([]);
  });

  it("comes back when the row gains a value", async () => {
    const w = cards([{ id: "a", unit: "654", driver: null, truck: "733", place: null }]);
    expect(shown(w)).toEqual(["733"]);
    await w.setProps({ rows: [{ id: "a", unit: "654", driver: "ANN LEE", truck: null, place: null }] });
    await nextTick();
    expect(shown(w)).toEqual(["ANN LEE"]);
  });

  it("leaves the title its dash: a missing identifier is something to see", () => {
    const w = cards([{ id: "a", unit: null, driver: "ANN LEE", truck: null, place: null }]);
    expect(w.get("li").text()).toContain("—");
  });
});
