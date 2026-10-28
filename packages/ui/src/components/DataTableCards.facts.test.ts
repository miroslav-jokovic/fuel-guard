import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import DataTable, { type DataTableColumn } from "./DataTable.vue";
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

function mountTable(opts: { touch?: boolean; columns?: DataTableColumn[]; withLink?: boolean } = {}) {
  const Host = defineComponent({
    emits: ["row-click"],
    setup(_, { emit }) {
      if (opts.touch) provideTouchTargets();
      return () =>
        h(
          DataTable,
          { columns: opts.columns ?? MARKED, rows: ROWS, onRowClick: (row: unknown) => emit("row-click", row) },
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

  it("keeps the full card for a table whose page has marked nothing", () => {
    setViewport(false);
    const unmarked = MARKED.map(({ card: _card, ...col }) => col);
    const w = mountTable({ columns: unmarked });
    expect(w.find("dl").exists()).toBe(true);
    expect(w.text()).toContain("Volvo");
  });
});
