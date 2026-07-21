// NOTE: the dashboard itself is data-driven (Vue Query + Supabase + Chart.js) and exercised via the
// pure `aggregateDashboard` tests in @fuelguard/shared. Here we cover safe presentational pieces.
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import StatusBadge from "@/components/StatusBadge.vue";

describe("StatusBadge", () => {
  it("renders the status text", () => {
    expect(mount(StatusBadge, { props: { status: "resolved" } }).text()).toContain("resolved");
  });
});
