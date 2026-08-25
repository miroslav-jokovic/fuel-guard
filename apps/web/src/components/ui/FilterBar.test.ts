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
