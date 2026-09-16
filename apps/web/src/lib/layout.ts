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
