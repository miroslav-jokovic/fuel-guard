import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import RiskList from "./RiskList.vue";

/**
 * The two risk lists' container (DR7a's sibling, 2026-09-16).
 *
 * ── WHAT IS ACTUALLY AT RISK HERE ────────────────────────────────────────────────────────────────
 * `dashboardEquivalence.test.ts` already pins that the title still renders as an `h3` with the same
 * text, so moving this component onto `ChartCard` is covered for free on the half anybody would
 * think to check. What no existing test can see is the `flex h-full flex-col` that now arrives as a
 * FALLTHROUGH attribute rather than a class on a `BaseCard` this file owned. Fallthrough is easy to
 * lose — a future `ChartCard` that grows a wrapper element, or takes its own `class` prop, stops
 * forwarding it — and the loss is silent: a populated list looks identical either way, and only the
 * EMPTY card, sitting beside a full one in the same grid row, collapses its centred sentence to the
 * top. So the empty state is what this file asserts.
 */

const rows = [
  { id: "v1", label: "Unit 1207", anomalyCount: 4, criticalCount: 1 },
  { id: "v2", label: "Unit 1310", anomalyCount: 2, criticalCount: 0 },
];

const render = (props: Partial<Record<string, unknown>> = {}) =>
  mount(RiskList, {
    props: { title: "Top vehicles by risk", rows, emptyLabel: "No flagged vehicles", ...props },
    global: { stubs: { RouterLink: { template: "<a><slot /></a>" } } },
  });

describe("the dashboard's risk list", () => {
  it("takes its header from ChartCard rather than spelling one out again", () => {
    const wrapper = render();
    const heading = wrapper.find("h3");
    expect(heading.exists()).toBe(true);
    expect(heading.text()).toBe("Top vehicles by risk");
    // The copy that was here rendered the `h3` as a direct child of the card. Going through
    // `ChartCard` puts it inside that component's header block, which is what makes the four titled
    // panels on this grid one thing instead of four.
    expect(wrapper.find(".mb-4 h3").exists()).toBe(true);
  });

  /**
   * ⚠ The assertion that would catch a lost fallthrough. `h-full` and `flex-col` have to reach the
   * CARD — the outermost element — because the empty state below centres itself with `flex-1`, and
   * `flex-1` fills nothing without a column to fill.
   */
  it("passes its column context through to the card, so an empty list can centre itself", () => {
    const empty = render({ rows: [] });
    const card = empty.element as HTMLElement;
    expect(card.className).toContain("h-full");
    expect(card.className).toContain("flex-col");
    expect(empty.find(".flex-1").exists()).toBe(true);
    expect(empty.text()).toContain("No flagged vehicles");
  });

  it("still links each row when given a base, and renders plain rows without one", () => {
    expect(render({ linkBase: "/vehicles" }).findAll("a")).toHaveLength(2);
    expect(render().findAll("a")).toHaveLength(0);
  });
});
