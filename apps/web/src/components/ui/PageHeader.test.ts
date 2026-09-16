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

async function mountAt(path: string, attach = false, props: Record<string, unknown> = {}) {
  const router = await routerFor(path);
  return mount(PageHeader, {
    props,
    global: { plugins: [router] },
    ...(attach ? { attachTo: document.body } : {}),
  });
}

/**
 * The hero plate (D-DR15) — the dashboard's greeting band.
 *
 * The plate is DECORATION, and the whole accessibility claim rests on it saying so: an empty `alt`
 * plus `aria-hidden`, so a screen reader reaches the greeting rather than describing a photograph of
 * a truck first. That is the kind of attribute a later "tidy-up" adds a helpful description to, so
 * it is asserted rather than trusted.
 */
describe("PageHeader hero plate (D-DR15)", () => {
  afterEach(() => document.body.replaceChildren());

  it("renders no plate at all for the ordinary header", async () => {
    const w = await mountAt("/");
    expect(w.find("img").exists()).toBe(false);
    // The plain header keeps its rule; the hero variant replaces it with a card edge.
    expect(w.get("header").classes()).toContain("border-b");
  });

  it("carries the plate as decoration, never as content", async () => {
    const w = await mountAt("/", false, { hero: "/hero/highway-dawn.webp" });
    const img = w.get("img");
    expect(img.attributes("src")).toBe("/hero/highway-dawn.webp");
    expect(img.attributes("alt")).toBe("");
    expect(img.attributes("aria-hidden")).toBe("true");
    expect(w.get("header").classes()).not.toContain("border-b");
  });

  /**
   * The greeting has to sit ON the band rather than beside it, so the plate is pinned behind the
   * text with a negative z-index and is not clickable. A plate that captured pointer events would
   * swallow clicks on the header's own action buttons, which sit over it on a wide screen.
   */
  it("keeps the plate behind the text and out of the way of the actions", async () => {
    const w = await mountAt("/", false, { hero: "/hero/highway-dawn.webp" });
    const classes = w.get("img").classes();
    expect(classes).toContain("-z-10");
    expect(classes).toContain("pointer-events-none");
    expect(w.get("header").classes()).toContain("isolate");
  });

  it("has no axe violations with a plate behind it", async () => {
    const w = await mountAt("/", true, { hero: "/hero/highway-dawn.webp", title: "Good morning, Miki" });
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

/**
 * The night plate (D-DR19) — dark mode gets a different photograph, not the same one dimmed.
 *
 * ⚠ These drive the scheme through `useColorScheme().set()` rather than stubbing the composable.
 * It is module-level state writing one CSS property on `<html>`, so it is honest to exercise in a
 * test — and stubbing it would leave the thing under test (that `PageHeader` reads the SAME answer
 * the rest of the app reads) unasserted, which is the whole point of deriving rather than asking.
 */
describe("PageHeader night plate (D-DR19)", () => {
  const DAY = "/hero/highway-dawn.webp";
  const NIGHT = "/hero/highway-night.webp";

  afterEach(async () => {
    const { useColorScheme } = await import("@/composables/useColorScheme");
    useColorScheme().set("light");
  });

  const setScheme = async (value: "light" | "dark") => {
    const { useColorScheme } = await import("@/composables/useColorScheme");
    useColorScheme().set(value);
  };

  it("hangs the day plate in light mode and the night plate in dark", async () => {
    await setScheme("light");
    const day = await mountAt("/", false, { hero: DAY, heroDark: NIGHT });
    expect(day.find("img").attributes("src")).toBe(DAY);

    await setScheme("dark");
    const night = await mountAt("/", false, { hero: DAY, heroDark: NIGHT });
    expect(night.find("img").attributes("src")).toBe(NIGHT);
  });

  /**
   * ⚠ The compromise, asserted so it is a decision rather than a surprise. `prairie-dusk` and
   * `coast-mist` have no night variant yet, and a caller passing only `hero` must keep rendering
   * its plate — not nothing. It also documents the cost: that caller keeps the 6.54:1 band in dark
   * mode until its own night plate exists.
   */
  it("falls back to the day plate when a caller has no night variant", async () => {
    await setScheme("dark");
    const w = await mountAt("/", false, { hero: DAY });
    expect(w.find("img").attributes("src")).toBe(DAY);
  });

  // The plate stays DECORATION in either scheme — the D-DR15 claim must not survive only in light.
  it("keeps the night plate decorative", async () => {
    await setScheme("dark");
    const w = await mountAt("/", false, { hero: DAY, heroDark: NIGHT });
    const img = w.find("img");
    expect(img.attributes("alt")).toBe("");
    expect(img.attributes("aria-hidden")).toBe("true");
  });
});
