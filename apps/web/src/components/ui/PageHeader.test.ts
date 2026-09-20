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
      // A route that carries a plate, so the header's two chromes can be compared on the same
      // component rather than inferred from a prop that no longer exists.
      {
        path: "/greeting",
        name: "greeting",
        component: stub,
        meta: { title: "Good morning", hero: "/hero/highway-dawn.webp" },
      },
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

async function mountAt(path: string, attach = false, props: Record<string, unknown> = {}) {
  const router = await routerFor(path);
  return mount(PageHeader, {
    props,
    global: { plugins: [router] },
    ...(attach ? { attachTo: document.body } : {}),
  });
}

/**
 * The header that stands on the page backdrop (D-DT18, and D-DR15 before it).
 *
 * ⚠ These assertions used to be about an `<img>` this component owned. The plate is `AppShell`'s
 * layer now — a photograph that has to end where its header ends is a picture that ran out — so
 * what is left here is the header's half of the arrangement: it knows something is behind it, and
 * it drops the card and the rule it would otherwise draw across the middle of a photograph. WHICH
 * plate, and whether there is one at all, is `lib/layout.test.ts`.
 */
describe("PageHeader on the page backdrop (D-DT18)", () => {
  afterEach(() => document.body.replaceChildren());

  it("draws no plate of its own, on any route", async () => {
    expect((await mountAt("/")).find("img").exists()).toBe(false);
    expect((await mountAt("/greeting")).find("img").exists()).toBe(false);
  });

  it("keeps its rule on an ordinary page and drops it on a backdrop", async () => {
    expect((await mountAt("/")).get("header").classes()).toContain("border-b");

    const onPlate = (await mountAt("/greeting")).get("header").classes();
    expect(onPlate).not.toContain("border-b");
    // ⚠ And no card either (D-DT15): a surface, a ring and an elevation made a photograph look
    // like a widget and put a border around the one element on the page that is not a control.
    for (const chrome of ["bg-surface", "ring-1", "shadow-card", "rounded-surface"]) {
      expect(onPlate).not.toContain(chrome);
    }
  });

  /**
   * The greeting stands level with the subject of the photograph rather than above it, which is
   * what the band's own height buys — 136px, the prototype's, measured against the plate's crop.
   */
  it("gives the greeting the band's height, and the plain header none", async () => {
    expect((await mountAt("/greeting")).get("header").classes()).toContain("min-h-34");
    expect((await mountAt("/")).get("header").classes()).not.toContain("min-h-34");
  });

  it("has no axe violations on the backdrop", async () => {
    const w = await mountAt("/greeting", true, { title: "Good morning, Miki" });
    const result = await axe.run(w.element as HTMLElement, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});

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
