import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DonutBreakdown from "./DonutBreakdown.vue";

const items = [
  { key: "moving", label: "Moving fuel", value: 75, valueLabel: "$75", color: "rgb(5, 150, 105)" },
  { key: "idle", label: "Idle waste", value: 25, valueLabel: "$25", color: "rgb(194, 65, 12)" },
];

describe("DonutBreakdown", () => {
  it("keeps the center KPI and exact labeled values available without chart interaction", () => {
    const wrapper = mount(DonutBreakdown, {
      props: {
        items,
        centerValue: "$100",
        centerLabel: "total spend",
        chartLabel: "$100 in fuel cost composition",
      },
      global: { stubs: { BaseChart: true } },
    });

    expect(wrapper.get('[role="img"]').attributes("aria-label")).toBe("$100 in fuel cost composition");
    expect(wrapper.text()).toContain("$100");
    expect(wrapper.text()).toContain("Moving fuel");
    expect(wrapper.text()).toContain("$75");
    expect(wrapper.text()).toContain("75%");
    expect(wrapper.text()).toContain("Idle waste");
    expect(wrapper.text()).toContain("25%");
  });

  it("renders a clear zero-data breakdown without removing the donut or legend", () => {
    const wrapper = mount(DonutBreakdown, {
      props: {
        items: items.map((item) => ({ ...item, value: 0, valueLabel: "$0" })),
        centerValue: "$0",
        centerLabel: "total spend",
        chartLabel: "$0 in fuel cost composition",
      },
      global: { stubs: { BaseChart: true } },
    });

    expect(wrapper.findComponent({ name: "BaseChart" }).exists()).toBe(true);
    expect(wrapper.findAll("li")).toHaveLength(2);
    expect(wrapper.text().match(/0%/g)).toHaveLength(2);
  });

  /**
   * ── THE CENTRE TRADES THE TOTAL FOR THE PART (D-DT14) ────────────────────────────────────────
   * Driven through the chart's OWN `onHover`, read off the config the component hands `BaseChart`,
   * because that is the interface that ships: jsdom has no canvas, so Chart.js cannot be asked to
   * hit-test, but the handler it would call is a plain function on the config and calling it is
   * exactly what the real chart does.
   *
   * ⚠ The element index it is given is an index into the DRAWN slices, which is not the legend's
   * index — a zero-value item is dropped from the ring and kept in the legend. The third case below
   * is that difference, and it is the one a naive implementation gets wrong.
   */
  const mountDonut = (items_ = items) =>
    mount(DonutBreakdown, {
      props: {
        items: items_,
        centerValue: "$100",
        centerLabel: "total spend",
        chartLabel: "$100 in fuel cost composition",
      },
      global: { stubs: { BaseChart: true } },
    });

  /** The handler the real Chart.js would call, taken off the config the component published. */
  const hover = async (wrapper: ReturnType<typeof mountDonut>, index: number | null) => {
    const config = wrapper.findComponent({ name: "BaseChart" }).props("config") as {
      options: { onHover: (e: unknown, elements: { index: number }[]) => void };
    };
    config.options.onHover(null, index === null ? [] : [{ index }]);
    await wrapper.vm.$nextTick();
  };

  it("trades the centre total for the slice under the pointer, and puts it back", async () => {
    const wrapper = mountDonut();
    const centre = () => wrapper.get('[role="img"]').text();

    expect(centre()).toContain("$100");
    expect(centre()).toContain("total spend");

    await hover(wrapper, 1);
    expect(centre()).toContain("$25");
    expect(centre()).toContain("Idle waste");
    expect(centre(), "the total must not be shown twice").not.toContain("total spend");

    await hover(wrapper, null);
    expect(centre()).toContain("$100");
    expect(centre()).toContain("total spend");
  });

  it("lights the legend row the pointer's arc belongs to", async () => {
    const wrapper = mountDonut();
    await hover(wrapper, 1);
    const rows = wrapper.findAll("li");
    expect(rows[0]!.classes()).not.toContain("bg-surface-subtle");
    expect(rows[1]!.classes()).toContain("bg-surface-subtle");
  });

  /**
   * The index spaces differ the moment a slice is worth nothing: the ring draws two arcs, the
   * legend lists three rows, and arc 1 is legend row 2. An implementation keyed on the arc's index
   * lights "Idle waste" here, which is the wrong row and a plausible-looking one.
   */
  it("maps an arc to its own legend row when a zero-value slice is in the list", async () => {
    const withZero = [items[0]!, { ...items[1]!, value: 0, valueLabel: "$0" }, { key: "reefer", label: "Reefer", value: 25, valueLabel: "$25", color: "rgb(37, 99, 235)" }];
    const wrapper = mountDonut(withZero);

    await hover(wrapper, 1);
    expect(wrapper.get('[role="img"]').text()).toContain("Reefer");
    expect(wrapper.findAll("li")[2]!.classes()).toContain("bg-surface-subtle");
    expect(wrapper.findAll("li")[1]!.classes()).not.toContain("bg-surface-subtle");
  });

  /**
   * The track ring (D-DT14). It is drawn by the component rather than by Chart.js, so it is the
   * one part of the ring a unit test can see — and its stroke width has to be the PAINTED band
   * (the arcs' 3px border is subtracted), or the track reads as a halo around the ring.
   */
  it("draws a track behind the arcs, sized to the painted band", () => {
    const circle = mountDonut().get("svg circle");
    // outer = 192/2 - 7 = 89; band = 89 × (1 - 0.74) = 23.14; centre line = 89 - band/2.
    expect(Number(circle.attributes("r"))).toBeCloseTo(77.43, 1);
    expect(Number(circle.attributes("stroke-width"))).toBeCloseTo(17.14, 1);
  });
});
