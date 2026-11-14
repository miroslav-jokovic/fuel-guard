import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FilterBar from "./FilterBar.vue";

/**
 * FilterBar has NO default slot — only `#filters`, `#more` and `#actions`.
 *
 * That is easy to miss and fails silently: controls written as plain children compile, typecheck, lint
 * and render nothing at all. The fuel-spend page shipped its entire date/truck/grain row that way and
 * the bar came up empty on production, with the filters working perfectly and being impossible to see.
 *
 * These tests exist to make the trap explicit rather than to describe behaviour anybody would guess.
 */
const marker = '<button data-test="control">Dates</button>';

describe("FilterBar slots", () => {
  it("renders controls placed in #filters", () => {
    const w = mount(FilterBar, { slots: { filters: marker } });
    expect(w.find('[data-test="control"]').exists()).toBe(true);
  });

  it("renders page actions placed in #actions", () => {
    const w = mount(FilterBar, { slots: { actions: '<button data-test="act">Export</button>' } });
    expect(w.find('[data-test="act"]').exists()).toBe(true);
  });

  it("DROPS default-slot children — the trap that hid a live filter row", () => {
    const w = mount(FilterBar, { slots: { default: marker } });
    expect(w.find('[data-test="control"]').exists()).toBe(false);
  });

  it("shows the count it is given, so an empty bar is still legible", () => {
    const w = mount(FilterBar, { props: { count: 1433, countLabel: "fills" } });
    expect(w.text()).toContain("1,433");
    expect(w.text()).toContain("fills");
  });
});

/**
 * The count reads as a sentence, at one as well as at many.
 *
 * Every one of this component's 41 call sites passes a PLURAL noun, so before `lists/plural.ts` a
 * single result rendered "1 entries", "1 shelves", "1 truck stops" — on 41 surfaces, none of which
 * had noticed. The fix belongs in the component precisely because no call site changed: the 42nd
 * one will also pass a plural and will also be right.
 *
 * `plural.test.ts` holds the vocabulary and reads it out of the source; these two assertions hold
 * that the component actually asks.
 */
describe("FilterBar's count label", () => {
  it("goes singular at exactly one", () => {
    const w = mount(FilterBar, { props: { count: 1, countLabel: "entries" } });
    expect(w.text()).toContain("1 entry");
    expect(w.text()).not.toContain("1 entries");
  });

  it("stays plural at zero and above one", () => {
    // "0 results", never "0 result".
    expect(mount(FilterBar, { props: { count: 0, countLabel: "entries" } }).text()).toContain("0 entries");
    expect(mount(FilterBar, { props: { count: 2, countLabel: "entries" } }).text()).toContain("2 entries");
  });
});

describe("FilterBar's Clear filters", () => {
  const clearButtons = (w: ReturnType<typeof mount>) =>
    w.findAll("button").filter((b) => /^Clear (filters|all)$/.test(b.text()));

  it("is absent while nothing narrows the list", () => {
    const w = mount(FilterBar, { props: { activeCount: 0 }, slots: { filters: marker } });
    expect(clearButtons(w)).toHaveLength(0);
  });

  it("appears once a filter is set, and asks the page to clear everything", async () => {
    const w = mount(FilterBar, { props: { activeCount: 2 }, slots: { filters: marker } });
    expect(clearButtons(w).map((b) => b.text())).toEqual(["Clear filters"]);
    await clearButtons(w)[0]!.trigger("click");
    expect(w.emitted("clear-all")).toHaveLength(1);
  });

  it("is the only clear control even when chips are showing", () => {
    const w = mount(FilterBar, {
      props: { activeCount: 1, chips: [{ key: "unit", label: "Unit", value: "204" }] },
      slots: { more: marker },
    });
    expect(clearButtons(w).map((b) => b.text())).toEqual(["Clear filters"]);
  });
});

/**
 * The phone sheet (SMALL-SCREENS-PLAN.md D-SM8). Below `md` the bar is the search and ONE "Filters"
 * button; the page's filters open in a sheet. Which of the two a reader sees is CSS (`md:hidden`,
 * `max-md:`), so these pin what CSS cannot say: what is in the document, and when.
 */
describe("FilterBar's phone sheet", () => {
  const more = '<button data-test="secondary">Card</button>';
  const mountBar = (props = {}) =>
    mount(FilterBar, { props: { search: "", count: 12, countLabel: "drivers", ...props }, slots: { filters: marker, more }, attachTo: document.body });

  it("offers one Filters button, counting the filters that are set and not the search", () => {
    const w = mountBar({ search: "reyes", activeCount: 3 });
    expect(w.get("[data-filter-sheet-open]").text()).toBe("Filters 2");
    expect(mountBar({ activeCount: 0 }).get("[data-filter-sheet-open]").text()).toBe("Filters");
  });

  it("offers no Filters button to a bar with no filters to open", () => {
    const w = mount(FilterBar, { props: { search: "" } });
    expect(w.find("[data-filter-sheet-open]").exists()).toBe(false);
  });

  it("keeps the page's filters in ONE place, and adds its own header and close only while open", async () => {
    const w = mountBar({ activeCount: 1 });
    const sheet = w.get("[data-filter-sheet]");
    expect(sheet.attributes("role")).toBeUndefined();
    expect(sheet.classes()).toContain("max-md:hidden");
    // Closed: the secondary filters are not in the sheet (their home is the desk popover).
    expect(w.findAll('[data-test="control"]')).toHaveLength(1);
    expect(sheet.find('[data-test="secondary"]').exists()).toBe(false);
    expect(w.find("[data-filter-sheet-close]").exists()).toBe(false);

    await w.get("[data-filter-sheet-open]").trigger("click");
    expect(sheet.attributes("role")).toBe("dialog");
    expect(sheet.classes()).toContain("max-md:fixed");
    expect(w.findAll('[data-test="control"]')).toHaveLength(1);
    expect(sheet.find('[data-test="secondary"]').exists()).toBe(true);
    expect(w.get("[data-filter-sheet-close]").text()).toBe("Show 12 drivers");
  });

  it("closes from its button, from the scrim and from Escape", async () => {
    const w = mountBar();
    const open = () => w.get("[data-filter-sheet-open]").trigger("click");
    const isOpen = () => w.get("[data-filter-sheet]").attributes("role") === "dialog";
    await open();
    await w.get("[data-filter-sheet-close]").trigger("click");
    expect(isOpen()).toBe(false);
    await open();
    await w.get('button[aria-label="Close filters"]').trigger("click");
    expect(isOpen()).toBe(false);
    await open();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await w.vm.$nextTick();
    expect(isOpen()).toBe(false);
  });

  it("clears from inside the sheet with the page's own clear-all", async () => {
    const w = mountBar({ activeCount: 2 });
    await w.get("[data-filter-sheet-open]").trigger("click");
    await w.get("[data-filter-sheet]").findAll("button").find((b) => b.text() === "Clear filters")!.trigger("click");
    expect(w.emitted("clear-all")).toHaveLength(1);
  });
});
