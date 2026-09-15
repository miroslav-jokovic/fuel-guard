// Moved out of `pages/DashboardPage.test.ts`, which was named for a page it never mounted.
//
// That name was not harmless. It read as dashboard coverage, it stayed green through the 488-line
// DashboardPage being split into a shell plus two tab components, and its pass count was quoted as
// evidence the split was safe. It was evidence of nothing. The Dashboard's own contract is pinned in
// `pages/DashboardPage.shell.test.ts`; this file tests the badge it always actually tested.
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import StatusBadge from "@/components/StatusBadge.vue";

describe("StatusBadge", () => {
  it("renders the status text", () => {
    expect(mount(StatusBadge, { props: { status: "resolved" } }).text()).toContain("resolved");
  });
});
