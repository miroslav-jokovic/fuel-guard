import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ReportScopeBar from "./ReportScopeBar.vue";

describe("ReportScopeBar", () => {
  it("renders one standard report-scope perimeter and its control", () => {
    const w = mount(ReportScopeBar, {
      props: { title: "Reporting quarter", description: "All figures use this filing period." },
      slots: { control: '<button data-testid="period">2026 Q3</button>' },
    });

    expect(w.get("section").attributes("aria-label")).toBe("Reporting quarter");
    expect(w.text()).toContain("All figures use this filing period.");
    expect(w.get('[data-testid="period"]').text()).toBe("2026 Q3");
  });

  it("uses the shared plural behavior for an optional result count", () => {
    const one = mount(ReportScopeBar, {
      props: { title: "Reporting quarter", count: 1, countLabel: "jurisdictions" },
    });
    const many = mount(ReportScopeBar, {
      props: { title: "Reporting quarter", count: 2, countLabel: "jurisdictions" },
    });

    expect(one.text()).toContain("1 jurisdiction");
    expect(one.text()).not.toContain("1 jurisdictions");
    expect(many.text()).toContain("2 jurisdictions");
  });
});
