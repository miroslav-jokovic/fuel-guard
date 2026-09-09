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
 * Every one of this component's 41 call sites passes a PLURAL noun, so before `lib/plural.ts` a
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
