import type { RouteMeta } from "vue-router";

/** The shells `App.vue` can render a page in. `undefined` means the default — `AppShell`. */
export type LayoutName = "auth" | "public" | "apply" | "lab" | "shop" | undefined;

/**
 * Which shell a route renders in (G1, UI-GAPS-PLAN.md).
 *
 * Pure, and separate from `App.vue`, because the interesting half is a rule rather than a template:
 * a `public: true` route is reachable with AND without a session, and for the dead-end pages the
 * right chrome differs between those two cases.
 *
 * Signed in, `AppShell` is what somebody who mistyped a URL wants — the sidebar is how they get back
 * to where they meant to go. Signed out, `AppShell` is actively wrong: it calls `useModulesQuery()`
 * unconditionally, so it fires a guaranteed 401 behind a page whose entire job is to stay legible
 * when things are broken, and it renders a navigation menu to somebody with no account.
 *
 * `layoutWhenSignedOut` is therefore an override that only applies with no session, and only where a
 * route asks for it. Every other route is unaffected — `layout` alone decides, exactly as before.
 *
 * `shop` (D-INV17) is a SIGNED-IN shell like the default one, and takes no `layoutWhenSignedOut`:
 * the count screen sits behind the desk's login and the router bounces a session without it long
 * before this function is asked anything.
 */
export function resolveLayout(meta: RouteMeta, isAuthenticated: boolean): LayoutName {
  if (!isAuthenticated && meta.layoutWhenSignedOut) return meta.layoutWhenSignedOut as LayoutName;
  return meta.layout as LayoutName;
}

/**
 * Does this route want the shell's content area edge to edge (D-DR5, DESIGN-REFRESH-2026-09.md §4)?
 *
 * ⚠ It is deliberately NOT a value of `LayoutName`, and the plan records why: the first draft of
 * D-DR5 said the live map gets `layout: "canvas"`, and `layout` already means *which shell
 * entirely*. Every name in `LayoutName` REPLACES `AppShell` — sidebar, top bar, notification bell
 * and all — so a sixth one would have had to re-declare the navigation, which is a second source of
 * truth for the nav and exactly what the root `CLAUDE.md` names as a workaround.
 *
 * A full-bleed page still wants the whole shell. Only the outlet changes: the padded container
 * drops its gutters and `<main>` is given a height, so a map, a canvas or a board can fill what is
 * left of the viewport instead of scrolling a document. One shell, one navigation.
 *
 * Reading it through a function rather than `route.meta.fullBleed` at the call site keeps the
 * default in ONE place: a route that says nothing is a document, which is what every route but one
 * is today.
 *
 * ── WHY IT TAKES A ROUTE AND NOT JUST `meta` NOW (D-DR24, 2026-09-16) ───────────────────────────
 * `/live-map` was the one full-bleed route and `meta.fullBleed: true` was enough. With the map
 * consolidated onto the Dashboard's Dispatch tab, full-bleed became a property of WHICH TAB is open
 * — the dashboard is a document on Fleet and a workspace on Dispatch — and a static boolean cannot
 * say that.
 *
 * ⚠ The tab is read from the URL (`?tab=`) rather than from a layout store the page writes into,
 * and that ordering is the reason: the shell decides its outlet while the page is still being
 * constructed, so a signal the page emits arrives a frame late and the map would be built at the
 * document's width and then resized. The URL is also the only place the tab already survives a
 * reload — `DashboardPage` keeps `?tab=` in sync for exactly these two readers.
 */
export function isFullBleed(route: { meta: RouteMeta; query?: Record<string, unknown> }): boolean {
  const declared = route.meta.fullBleed;
  return typeof declared === "function" ? declared(route) === true : declared === true;
}

/**
 * Is the desktop sidebar collapsed right now (D-DR25)?
 *
 * Three inputs, and the order of them is the whole rule:
 *
 *   · `stored` — what the reader chose, in `localStorage`, for ordinary document pages.
 *   · `fullBleed` — whether the surface on screen is a workspace. Measured at 1512×900, the live map
 *     is **67% of the viewport with the sidebar open and 79% with it collapsed**; on the page it
 *     replaced the same trade read 71% vs 83%. A dispatcher watching a board wants those points and
 *     a reader of a document does not care, so a workspace starts collapsed.
 *   · `override` — what they did about it WHILE ON that workspace, which must win over both.
 *
 * ⚠ **The automatic collapse is never written to `localStorage`, and that is the point of having a
 * function rather than an assignment.** If it were stored, one visit to the live map would leave the
 * reader with every page collapsed and no memory of asking for it — a surface quietly rewriting a
 * global preference as a side effect, which this repo's register names as a workaround. So the
 * stored value is what they chose, this function is what is on screen, and leaving the workspace
 * restores them to what they chose without a restore step existing at all.
 *
 * ⚠ `override` is cleared by the CALLER when `fullBleed` changes: an expansion asked for on the map
 * is about the map, and carrying it onto the next workspace would be inventing a preference nobody
 * set.
 */
export function sidebarIsCollapsed(input: {
  stored: boolean;
  fullBleed: boolean;
  override: boolean | null;
}): boolean {
  return input.override ?? (input.fullBleed || input.stored);
}

/**
 * Which photographic plate, if any, sits behind this route's page (D-DT18/D-DT19).
 *
 * ── WHY THE SHELL ASKS AND THE HEADER NO LONGER DOES ───────────────────────────────────────────
 * The plate used to live inside `PageHeader`'s hero band, which meant it had to END where that band
 * ended — and the only tool left for the ending was a fade that dissolved the photograph into empty
 * canvas a few pixels above the tab strip. That is a picture that ran out. D-DT18 makes it a layer
 * of the PAGE: it starts at the top, bleeds past the right gutter, and descends through the tab row
 * and into the KPI row, where the opaque cards occlude it and it survives only in the gutters
 * between them. Nothing about it ends; the content covers it up, which is what depth looks like.
 *
 * A layer that tall cannot belong to the header, and the bleed negates a gutter `AppShell` owns, so
 * the shell draws it and the route says which one. This function is the whole of "which one".
 *
 * ⚠ It refuses a plate on a full-bleed route, and that refusal is the reason it exists rather than
 * `route.meta.hero` being read at the call site. The dashboard is a document on most tabs and a
 * workspace on the one holding the live map (D-DR24) — the SAME route, with and without gutters —
 * so "does this page want a backdrop" is not answerable from the meta alone. Asking `isFullBleed`
 * here keeps the two answers in one place; reading the meta directly in `AppShell` would have put a
 * decorative layer under the live map on the day somebody gave the dashboard a plate.
 *
 * Two functions, because two callers ask different questions: `AppShell` needs the URL to draw, and
 * `PageHeader` needs only to know that something is behind it — a greeting that sits ON a plate
 * takes no bottom rule and no card, and it must not have to know which photograph to work that
 * out. The scheme is therefore an argument of the first and not of the second.
 */
export function hasHeroPlate(route: { meta: RouteMeta; query?: Record<string, unknown> }): boolean {
  return !isFullBleed(route) && Boolean(route.meta.hero);
}

export function heroPlate(
  route: { meta: RouteMeta; query?: Record<string, unknown> },
  isDark: boolean,
): string | null {
  if (!hasHeroPlate(route)) return null;
  const { hero, heroDark } = route.meta;
  // ⚠ Falls back to the day plate rather than rendering nothing (D-DR19): two of the four shipped
  // plates have no night variant, and a missing file is not a reason to drop the layer.
  return (isDark && heroDark) || hero || null;
}
