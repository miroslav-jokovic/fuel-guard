import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";

/**
 * jsdom has no `matchMedia`, so `useMediaQuery` reports false and DataTable renders its NARROW card
 * branch by default. That is a sensible default for a test environment with no viewport — but the
 * alignment rules below are about a table, and a card view has no `<th>` to align. So the wide path
 * has to say so explicitly.
 *
 * Worth stating because it bit on the way in: adding the card view turned five green alignment tests
 * red without touching a line of alignment code. They were right to fail — they had silently stopped
 * testing a table.
 */
function setViewport(wide: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: wide,
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

/**
 * Column alignment (D-DS1).
 *
 * These exist because the defect they pin was invisible to every other check. `alignCls` used to
 * fall through to `text-center`, and `apps/web/CLAUDE.md` instructed authors to omit `align`, so
 * 376 of 387 column definitions rendered centred — money, gallons and MPG included — while the
 * component's own docstring claimed words-left/numbers-right. Reading the file did not reveal it;
 * mounting it did. Alignment is layout, so `lint:tokens` (colour) will never catch a regression
 * here. This file is the only thing that will.
 */

beforeEach(() => setViewport(true));

const mountTable = (columns: DataTableColumn[]) =>
  mount(DataTable, {
    props: {
      columns,
      rows: [{ unit: "Unit 204", gallons: 118.4, amount: "$412.86", flag: "ok" }],
      rowKey: "unit",
    },
    global: {
      stubs: { RouterLink: true, AppIcon: true, TableSkeleton: true, ErrorState: true },
    },
  });

const headerClasses = (wrapper: ReturnType<typeof mountTable>) =>
  wrapper.findAll("thead th").map((th) => th.attributes("class") ?? "");
const cellClasses = (wrapper: ReturnType<typeof mountTable>) =>
  wrapper.findAll("tbody td").map((td) => td.attributes("class") ?? "");

describe("DataTable column alignment", () => {
  it("left-aligns a text column that declares no alignment", () => {
    const wrapper = mountTable([{ key: "unit", label: "Unit" }]);
    expect(cellClasses(wrapper)[0]).toContain("text-left");
    expect(cellClasses(wrapper)[0]).not.toContain("text-center");
  });

  it("right-aligns a numeric column and gives it tabular figures", () => {
    const wrapper = mountTable([{ key: "gallons", label: "Gallons", numeric: true }]);
    expect(cellClasses(wrapper)[0]).toContain("text-right");
    expect(cellClasses(wrapper)[0]).toContain("tabular-nums");
    expect(cellClasses(wrapper)[0]).not.toContain("text-center");
  });

  it("lets an explicit align override the default in both directions", () => {
    const wrapper = mountTable([
      { key: "unit", label: "Unit", align: "right" },
      { key: "gallons", label: "Gallons", numeric: true, align: "left" },
    ]);
    const [text, numeric] = cellClasses(wrapper);
    expect(text).toContain("text-right");
    expect(numeric).toContain("text-left");
    // an explicit align changes position only — a numeric column keeps its figures tabular
    expect(numeric).toContain("tabular-nums");
  });

  it("centres a column only when it explicitly asks, for control columns", () => {
    const wrapper = mountTable([{ key: "flag", label: "", align: "center" }]);
    expect(cellClasses(wrapper)[0]).toContain("text-center");
  });

  it("gives a header the same alignment as its column", () => {
    const wrapper = mountTable([
      { key: "unit", label: "Unit" },
      { key: "gallons", label: "Gallons", numeric: true },
      { key: "flag", label: "Flag", align: "center" },
    ]);
    expect(headerClasses(wrapper).map((c) => c.match(/text-(left|right|center)/)?.[0])).toEqual([
      "text-left",
      "text-right",
      "text-center",
    ]);
  });

  it("never centres by default, for any combination the contract allows", () => {
    const wrapper = mountTable([
      { key: "unit", label: "Unit" },
      { key: "gallons", label: "Gallons", numeric: true },
      { key: "amount", label: "Amount", numeric: true, sortable: true },
      { key: "flag", label: "Flag", cellClass: "font-medium" },
    ]);
    for (const cls of [...headerClasses(wrapper), ...cellClasses(wrapper)]) {
      expect(cls).not.toContain("text-center");
    }
  });
});

/**
 * Narrow-screen card view (phase 6).
 *
 * jsdom reports no media query matches by default, so `useMediaQuery("(min-width: 768px)")` is
 * false here and the component renders its CARD branch. That makes the narrow path the one this
 * suite exercises for free — which is the right way round, since the wide path is the one a person
 * looks at every day and the narrow one is the path nobody opens on a desktop.
 */
describe("DataTable narrow-screen card view", () => {
  beforeEach(() => setViewport(false));

  const columns: DataTableColumn[] = [
    { key: "unit", label: "Unit" },
    { key: "driver", label: "Driver" },
    { key: "gallons", label: "Gallons", numeric: true, sortable: true },
  ];
  const rows = [
    { unit: "Unit 204", driver: "Maya Chen", gallons: 118.4 },
    { unit: "Unit 118", driver: "", gallons: 96.2 },
  ];
  const mountNarrow = (props = {}) =>
    mount(DataTable, {
      props: { columns, rows, rowKey: "unit", ...props },
      global: { stubs: { RouterLink: true, AppIcon: true, TableSkeleton: true, ErrorState: true } },
    });

  it("renders no table at all, which is the entire point", () => {
    const wrapper = mountNarrow();
    expect(wrapper.find("table").exists()).toBe(false);
    expect(wrapper.findAll("li")).toHaveLength(rows.length);
  });

  it("makes the first column the card heading, and keeps words in the labelled list", () => {
    const card = mountNarrow().findAll("li")[0]!;
    expect(card.text()).toContain("Unit 204");
    // Quantities are pulled out of the <dl> into their own row — on a phone they are compared
    // against each other, and a two-column grid puts them too far apart to compare.
    expect(card.findAll("dt").map((dt) => dt.text())).toEqual(["Driver"]);
    expect(card.text()).toContain("118.4");
  });

  it("promotes a status column to the heading row, where a scan looks for it", () => {
    const withStatus: DataTableColumn[] = [...columns, { key: "status", label: "Status" }];
    const wrapper = mount(DataTable, {
      props: { columns: withStatus, rows: [{ ...rows[0], status: "Alert" }], rowKey: "unit" },
      global: { stubs: { RouterLink: true, AppIcon: true, TableSkeleton: true, ErrorState: true } },
    });
    const card = wrapper.findAll("li")[0]!;
    // present on the card, but NOT as one of the labelled rows
    expect(card.text()).toContain("Alert");
    expect(card.findAll("dt").map((dt) => dt.text())).not.toContain("Status");
  });

  it("shows an em-dash for a blank value rather than an empty row", () => {
    const card = mountNarrow().findAll("li")[1]!;
    expect(card.findAll("dd")[0]!.text()).toBe("—");
  });

  it("keeps sorting reachable, because a header is not available to carry it", () => {
    const wrapper = mountNarrow();
    const select = wrapper.find("select");
    expect(select.exists()).toBe(true);
    // one option per sortable column, plus the default
    expect(select.findAll("option")).toHaveLength(2);
    select.setValue("gallons");
    expect(wrapper.emitted("sort")?.[0]).toEqual(["gallons"]);
  });

  it("keeps selection reachable", () => {
    const wrapper = mountNarrow({ selectable: true, selected: new Set<string>() });
    const box = wrapper.find('input[type="checkbox"]');
    expect(box.exists()).toBe(true);
    box.trigger("change");
    expect(wrapper.emitted("update:selected")).toBeTruthy();
  });

  it("still renders empty, error and loading states", () => {
    expect(mountNarrow({ rows: [], emptyText: "No fills yet." }).text()).toContain("No fills yet.");
    expect(mountNarrow({ error: "Could not load" }).findComponent({ name: "ErrorState" }).exists()).toBe(true);
  });
});

/**
 * The extraction net for R3b (DRIVER-ROSTER-PLAN.md §5): the narrow-screen card branch moves out of
 * `DataTable.vue` into `DataTableCards.vue`, because the component stood at 454 lines against a
 * 500-line budget and column management does not fit in the 46 that were left.
 *
 * The behavioural tests above already cover what a card SHOWS. These pin what it RENDERS — including
 * the slot forwarding, which is the part an extraction across a component boundary can quietly
 * change. Taken before the move; they must survive it unchanged.
 *
 * Two things are normalised out first, and neither is structure:
 *  - the card sort control's `listId`, which is `Math.random()` per mount. Left raw, this snapshot
 *    would have failed on its SECOND run for a reason that has nothing to do with the extraction —
 *    an intermittent CI failure built into the net meant to catch one.
 *  - whitespace inside authored HTML comments, which moves when a block changes nesting depth.
 *    Vue strips comments from production builds entirely, so their indentation is not something a
 *    reader can ever see. `<!--v-if-->` markers survive intact, because a branch that stopped
 *    rendering IS structure.
 */
const stable = (html: string): string =>
  html
    .replace(/dt-[a-z0-9]{6}-sort/g, "dt-test-sort")
    .replace(/<!--([\s\S]*?)-->/g, (_m, body: string) => `<!--${body.replace(/\s+/g, " ").trim()}-->`);
const SNAPSHOT_COLUMNS: DataTableColumn[] = [
  { key: "unit", label: "Unit", sortable: true, width: "md", cellClass: "font-medium text-ink" },
  { key: "driver", label: "Driver", width: "lg" },
  { key: "gallons", label: "Gallons", numeric: true, sortable: true },
  { key: "status", label: "Status", width: "sm" },
];

const mountSnapshot = (wide: boolean) => {
  setViewport(wide);
  return mount(DataTable, {
    props: {
      columns: SNAPSHOT_COLUMNS,
      rows: [
        { unit: "Unit 204", driver: "Marcus Reyes", gallons: 118.4, status: "ok" },
        // Every blank branch on one row: heading keeps its value, the rest fall back to the dash.
        { unit: "Unit 991", driver: "", gallons: null, status: null },
      ],
      rowKey: "unit",
      selectable: true,
      selected: new Set(["Unit 204"]),
      sort: { key: "unit", dir: "asc" },
      expanded: new Set(["Unit 204"]),
    },
    slots: {
      // A custom cell slot, so the snapshot pins that slots reach the cards and not just the table.
      "cell-status": '<span data-testid="status-slot">{{ params.row.status ?? "none" }}</span>',
      actions: '<button type="button" data-testid="row-actions">Actions</button>',
      expanded: '<div data-testid="expanded">detail</div>',
      footer: '<div data-testid="footer">pagination</div>',
    },
    global: { stubs: { RouterLink: true, AppIcon: true, TableSkeleton: true, ErrorState: true } },
  });
};

describe("DataTable rendering, pinned across the R3b extraction", () => {
  it("renders the narrow card list unchanged", () => {
    expect(stable(mountSnapshot(false).html())).toMatchSnapshot();
  });

  it("renders the wide table unchanged", () => {
    expect(stable(mountSnapshot(true).html())).toMatchSnapshot();
  });
});
