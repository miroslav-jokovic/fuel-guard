import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { buildNavGroups } from "@/lib/nav";
import { phoneTabs } from "@/lib/phoneFirst";
import SectionTabBar from "./SectionTabBar.vue";

/**
 * The shop's doors along the bottom (DESIGN-SYSTEM-CONTRACT.md §9 rule 7): one link per sidebar row,
 * the current one marked, and drawn below `md` only.
 */
async function bar(current: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push("/shop");
  const group = phoneTabs("/shop", buildNavGroups("admin", null))!;
  return mount(SectionTabBar, { props: { group, current }, global: { plugins: [router] } });
}

describe("SectionTabBar", () => {
  it("draws one door per sidebar row, below md only", async () => {
    const w = await bar("/shop/units");
    expect(w.get("nav").classes()).toContain("md:hidden");
    expect(w.findAll("a").map((a) => a.attributes("href"))).toEqual(["/shop", "/shop/inventory", "/shop/units", "/shop/inspections"]);
  });

  it("marks the door the page stands under, and only that one", async () => {
    const w = await bar("/shop/units");
    expect(w.findAll("a[aria-current=page]").map((a) => a.text())).toEqual(["Trucks & trailers"]);
  });

  it("gives every door a 48 px target or more", async () => {
    for (const a of (await bar("/shop")).findAll("a")) expect(a.classes()).toContain("min-h-14");
  });
});
