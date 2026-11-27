import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { buildNavGroups } from "@/lib/nav";
import { phoneTabs } from "@/lib/phoneFirst";
import SectionTabBar from "./SectionTabBar.vue";

/**
 * The shop's doors along the bottom (DESIGN-SYSTEM-CONTRACT.md §9 rule 7): the first four sidebar rows and More for the rest (`tabRowDoors`),
 * the current one marked, and drawn below `md` only.
 */
async function bar(current: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push("/shop");
  const group = phoneTabs("/shop", buildNavGroups("admin", null))!;
  return mount(SectionTabBar, { props: { group, current }, global: { plugins: [router] } });
}

describe("SectionTabBar", () => {
  it("draws the first four sidebar rows and folds the rest into More, below md only", async () => {
    const w = await bar("/shop/units");
    expect(w.get("nav").classes()).toContain("md:hidden");
    expect(w.findAll("nav a").map((a) => a.attributes("href"))).toEqual(["/shop", "/shop/units", "/shop/assets", "/shop/inspections"]);
    expect(w.get("nav button").text()).toBe("More");
  });

  it("opens More as a sheet holding the rest of the sidebar's rows", async () => {
    const w = await bar("/shop/units");
    await w.get("nav button").trigger("click");
    const sheet = document.body.querySelector('[role="dialog"]')!;
    expect([...sheet.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["/shop/follow-ups", "/shop/inventory"]);
    w.unmount();
  });

  it("lights More when the page stands under one of its rows", async () => {
    const w = await bar("/shop/follow-ups");
    expect(w.findAll("nav a[aria-current=page]")).toHaveLength(0);
    expect(w.get("nav button").attributes("aria-current")).toBe("page");
  });

  it("marks the door the page stands under, and only that one", async () => {
    const w = await bar("/shop/units");
    expect(w.findAll("a[aria-current=page]").map((a) => a.text())).toEqual(["Trucks & trailers"]);
  });

  it("gives every door a 48 px target or more", async () => {
    for (const a of (await bar("/shop")).findAll("nav a, nav button")) expect(a.classes()).toContain("min-h-14");
  });
});
