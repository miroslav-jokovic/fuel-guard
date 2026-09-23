import { describe, it, expect } from "vitest";
import { hasHeroPlate, heroPlate, heroVars, isFullBleed, resolveLayout, sidebarIsCollapsed } from "./layout";

describe("resolveLayout (G1)", () => {
  it("signed out, a dead-end page swaps AppShell for the centered auth shell", () => {
    const meta = { public: true, layoutWhenSignedOut: "auth", title: "Page not found" };
    expect(resolveLayout(meta, false)).toBe("auth");
  });

  it("signed in, the same page keeps the normal shell so the sidebar is there to escape with", () => {
    const meta = { public: true, layoutWhenSignedOut: "auth", title: "Page not found" };
    expect(resolveLayout(meta, true)).toBeUndefined();
  });

  it("a route without the override is untouched in both states", () => {
    expect(resolveLayout({ layout: "auth" }, false)).toBe("auth");
    expect(resolveLayout({ layout: "auth" }, true)).toBe("auth");
    expect(resolveLayout({ requiresAuth: true, title: "Dashboard" }, true)).toBeUndefined();
    expect(resolveLayout({ layout: "apply" }, false)).toBe("apply");
    expect(resolveLayout({ layout: "public" }, false)).toBe("public");
    expect(resolveLayout({ layout: "lab" }, false)).toBe("lab");
  });

  it("the override never fires for a signed-in user, even if a route sets both", () => {
    expect(resolveLayout({ layout: "public", layoutWhenSignedOut: "auth" }, true)).toBe("public");
    expect(resolveLayout({ layout: "public", layoutWhenSignedOut: "auth" }, false)).toBe("auth");
  });
});

describe("isFullBleed (D-DR5, extended by D-DR24)", () => {
  /** A route, as much of one as this function reads. */
  const at = (meta: Record<string, unknown>, query: Record<string, unknown> = {}) => ({ meta, query });

  it("is false for a route that says nothing, which is every route but the dashboard", () => {
    expect(isFullBleed(at({ requiresAuth: true, title: "Dashboard" }))).toBe(false);
    expect(isFullBleed(at({}))).toBe(false);
  });

  it("is true only for the literal `true`", () => {
    expect(isFullBleed(at({ fullBleed: true }))).toBe(true);
    expect(isFullBleed(at({ fullBleed: false }))).toBe(false);
  });

  it("is independent of `layout`, which is the whole reason it is a separate flag", () => {
    // The amendment recorded in DESIGN-REFRESH-2026-09.md §7: `layout` names WHICH SHELL, and every
    // value of it replaces `AppShell` and its navigation. A full-bleed page keeps the shell and
    // changes only the outlet, so the two questions have to be answerable separately.
    expect(resolveLayout({ fullBleed: true, requiresAuth: true }, true)).toBeUndefined();
    expect(isFullBleed(at({ layout: "shop", fullBleed: true }))).toBe(true);
  });

  /**
   * D-DR24. The dashboard is a document on the Fleet tab and a workspace on the one holding the live
   * map, so the answer depends on the URL rather than on the route alone.
   */
  it("asks a predicate, so one route can be a document on one tab and a workspace on another", () => {
    const meta = { fullBleed: (route: { query?: Record<string, unknown> }) => route.query?.tab === "dispatch" };
    expect(isFullBleed(at(meta, { tab: "dispatch" }))).toBe(true);
    expect(isFullBleed(at(meta, { tab: "fleet" }))).toBe(false);
    expect(isFullBleed(at(meta))).toBe(false);
  });

  // ⚠ A predicate returning something truthy-but-not-true is a bug in the predicate, not permission
  // to drop the gutters. The `=== true` in both branches is what this holds.
  it("takes only `true` from a predicate, the same as from a literal", () => {
    expect(isFullBleed(at({ fullBleed: () => "yes" as unknown as boolean }))).toBe(false);
  });
});

/**
 * The sidebar on a workspace surface (D-DR25).
 *
 * ⚠ Every case here is about a preference NOT being written down. The defect this rule exists to
 * prevent is a reader visiting the live map once and finding every page in the app collapsed
 * afterwards, with nothing they did to explain it.
 */
describe("sidebarIsCollapsed (D-DR25)", () => {
  it("collapses on a workspace and leaves a document alone", () => {
    expect(sidebarIsCollapsed({ stored: false, fullBleed: true, override: null })).toBe(true);
    expect(sidebarIsCollapsed({ stored: false, fullBleed: false, override: null })).toBe(false);
  });

  // The reader who collapsed it everywhere keeps it collapsed everywhere.
  it("honours a stored collapse on a document page", () => {
    expect(sidebarIsCollapsed({ stored: true, fullBleed: false, override: null })).toBe(true);
  });

  it("lets a choice made on the workspace win over both, in both directions", () => {
    expect(sidebarIsCollapsed({ stored: false, fullBleed: true, override: false })).toBe(false);
    expect(sidebarIsCollapsed({ stored: true, fullBleed: false, override: true })).toBe(true);
    // ⚠ `false` is a real override and must not be read as "no override" — the bug a `||` would have.
    expect(sidebarIsCollapsed({ stored: true, fullBleed: true, override: false })).toBe(false);
  });

  /**
   * The property the whole rule is for: what is on screen is derived, so LEAVING the workspace
   * restores the reader's own preference without anything having been saved or restored.
   */
  it("returns to the stored preference the moment the surface stops being a workspace", () => {
    const stored = false;
    expect(sidebarIsCollapsed({ stored, fullBleed: true, override: null })).toBe(true);
    expect(sidebarIsCollapsed({ stored, fullBleed: false, override: null })).toBe(false);
  });
});

/**
 * The page backdrop's plate (D-DT18, D-DT19 — and D-DR19 before them, where these assertions
 * lived as `PageHeader` tests about an `<img>` prop).
 *
 * ⚠ The scheme is an ARGUMENT here rather than a composable read inside the function, which is
 * what moving the plate out of the header bought: choosing a photograph is arithmetic on the
 * route's meta, so it can be asked all four ways in four lines instead of by mounting a component
 * and writing a CSS property onto `<html>` to make it answer.
 */
const DAY = "/hero/highway-dawn.webp";
const NIGHT = "/hero/highway-night.webp";
const route = (meta: Record<string, unknown>, query: Record<string, unknown> = {}) => ({ meta, query });

describe("heroPlate (D-DT18)", () => {
  it("hangs the day plate in light and the night plate in dark", () => {
    expect(heroPlate(route({ hero: DAY, heroDark: NIGHT }), false)).toBe(DAY);
    expect(heroPlate(route({ hero: DAY, heroDark: NIGHT }), true)).toBe(NIGHT);
  });

  /**
   * ⚠ A compromise, asserted as a decision rather than met as a surprise. `prairie-dusk` and
   * `coast-mist` have no night variant and keep the 6.54:1 separation measured on them in dark
   * mode; a missing file is still not a reason to drop the whole layer.
   */
  it("falls back to the day plate when a route has no night variant", () => {
    expect(heroPlate(route({ hero: DAY }), true)).toBe(DAY);
  });

  it("is nothing at all on a route that declares no plate", () => {
    expect(heroPlate(route({ title: "Vehicles" }), false)).toBeNull();
    expect(hasHeroPlate(route({ title: "Vehicles" }))).toBe(false);
  });

  /**
   * ⚠ The reason this is a function and not `route.meta.hero` at the call site. The dashboard is
   * the SAME route with and without gutters — a document on most tabs, a workspace on the one
   * holding the live map (D-DR24) — so "does this page want a backdrop" cannot be answered from
   * the meta alone, and a decorative layer under the live map is what reading it directly buys.
   */
  it("refuses a plate whenever the outlet is edge to edge", () => {
    const dashboard = (tab: string) =>
      route({ hero: DAY, heroDark: NIGHT, fullBleed: (r: { query?: Record<string, unknown> }) => r.query?.tab === "map" }, { tab });

    expect(heroPlate(dashboard("fleet"), false)).toBe(DAY);
    expect(hasHeroPlate(dashboard("fleet"))).toBe(true);
    expect(heroPlate(dashboard("map"), false)).toBeNull();
    expect(hasHeroPlate(dashboard("map"))).toBe(false);
    // …and a statically full-bleed route with a plate declared on it gets the same answer.
    expect(heroPlate(route({ hero: DAY, fullBleed: true }), false)).toBeNull();
  });
});

describe("heroVars (D-DT22)", () => {
  it("hands a plated page its plate and a room measured past the SIDEBAR it actually has", () => {
    const open = heroVars("/hero/x.webp", false);
    expect(open?.["--backdrop-plate"]).toBe("url(/hero/x.webp)");
    expect(open?.["--hero-room"]).toBe("clamp(0px, 100vw - 17rem - 73rem, 87.5rem)");
    expect(heroVars("/hero/x.webp", true)?.["--hero-room"]).toContain("100vw - 3.75rem - 73rem");
  });

  it("declares the growth beside the room, where its var() can resolve", () => {
    expect(heroVars("/hero/x.webp", false)?.["--hero-grow"]).toBe("calc(var(--hero-room) * 0.035)");
  });

  it("is nothing at all on a page without a plate", () => {
    expect(heroVars(null, false)).toBeUndefined();
  });
});
