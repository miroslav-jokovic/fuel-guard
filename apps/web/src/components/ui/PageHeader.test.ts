import { describe, it, expect, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import axe from "axe-core";
import PageHeader from "./PageHeader.vue";

/**
 * The breadcrumb half of `PageHeader` (G2, UI-GAPS-PLAN.md). The walk itself is covered by
 * `lib/breadcrumbs.test.ts`; this covers what the component does with the result — which crumbs
 * become links, which one is marked as the current page, and when the trail is suppressed entirely.
 */
const stub = { template: "<div />" };
function routerFor(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "dashboard", component: stub, meta: { title: "Dashboard" } },
      { path: "/hazmat", name: "hazmat", component: stub, meta: { title: "HazmatGuard" } },
      {
        path: "/hazmat/loads",
        name: "hazmat-loads",
        component: stub,
        meta: { title: "Hazmat Loads", parent: "/hazmat" },
      },
      {
        path: "/hazmat/loads/:id",
        name: "hazmat-load",
        component: stub,
        meta: { title: "Hazmat Load", parent: "/hazmat/loads" },
      },
      { path: "/settings", name: "settings", component: stub, meta: { title: "Settings" } },
      {
        path: "/settings/audit",
        name: "audit",
        component: stub,
        meta: { title: "Audit Log", parent: "/settings" },
      },
      // The G1 catch-all, present because PageHeader relies on its NAME to detect a dead parent.
      { path: "/:pathMatch(.*)*", name: "not-found", component: stub, meta: { title: "Page not found" } },
    ],
  });
  return router.push(path).then(() => router);
}

async function mountAt(path: string, attach = false) {
  const router = await routerFor(path);
  return mount(PageHeader, {
    global: { plugins: [router] },
    ...(attach ? { attachTo: document.body } : {}),
  });
}

describe("PageHeader breadcrumbs (G2)", () => {
  afterEach(() => document.body.replaceChildren());

  it("renders the three-level chain, root first, with the current page last", async () => {
    const w = await mountAt("/hazmat/loads/hz_1");
    const items = w.findAll("nav[aria-label='Breadcrumb'] li").map((li) => li.text());
    expect(items).toEqual(["HazmatGuard", "Hazmat Loads", "Hazmat Load"]);
  });

  it("every crumb but the last is a link; the last is text marked as the current page", async () => {
    const w = await mountAt("/hazmat/loads/hz_1");
    const nav = w.find("nav[aria-label='Breadcrumb']");
    expect(nav.findAll("a").map((a) => a.attributes("href"))).toEqual(["/hazmat", "/hazmat/loads"]);
    const current = nav.find("[aria-current='page']");
    expect(current.text()).toBe("Hazmat Load");
    expect(current.find("a").exists()).toBe(false);
  });

  it("a top-level page shows no trail at all — the h1 below already says it", async () => {
    const w = await mountAt("/");
    expect(w.find("nav[aria-label='Breadcrumb']").exists()).toBe(false);
    expect(w.find("h1").text()).toBe("Dashboard");
  });

  it("the two-level settings case, which is 15 of the 24 routes with a parent", async () => {
    const w = await mountAt("/settings/audit");
    expect(w.findAll("nav[aria-label='Breadcrumb'] li").map((li) => li.text())).toEqual([
      "Settings",
      "Audit Log",
    ]);
  });

  it("a dead parent truncates rather than rendering a crumb labelled 'Page not found'", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/orphan", name: "orphan", component: stub, meta: { title: "Orphan", parent: "/gone" } },
        { path: "/:pathMatch(.*)*", name: "not-found", component: stub, meta: { title: "Page not found" } },
      ],
    });
    await router.push("/orphan");
    const w = mount(PageHeader, { global: { plugins: [router] } });
    // One crumb left, so the trail is suppressed — and crucially the catch-all's title never leaks in.
    expect(w.find("nav[aria-label='Breadcrumb']").exists()).toBe(false);
    expect(w.html()).not.toContain("Page not found");
  });

  it("has no axe violations on a three-level page", async () => {
    const w = await mountAt("/hazmat/loads/hz_1", true);
    const result = await axe.run(w.element as HTMLElement, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
