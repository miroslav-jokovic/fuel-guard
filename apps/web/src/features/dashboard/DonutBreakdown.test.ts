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
});
