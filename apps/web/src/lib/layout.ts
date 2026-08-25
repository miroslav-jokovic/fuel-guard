import type { RouteMeta } from "vue-router";

/** The shells `App.vue` can render a page in. `undefined` means the default — `AppShell`. */
export type LayoutName = "auth" | "public" | "apply" | "lab" | undefined;

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
 */
export function resolveLayout(meta: RouteMeta, isAuthenticated: boolean): LayoutName {
  if (!isAuthenticated && meta.layoutWhenSignedOut) return meta.layoutWhenSignedOut as LayoutName;
  return meta.layout as LayoutName;
}
