import type { RouteRecordRaw } from "vue-router";

/**
 * The dead ends (G1, UI-GAPS-PLAN.md) — the pages shown when there is nothing else to show.
 *
 * All three are `public: true`, so a signed-out visitor following a link that rotted is told what
 * happened rather than bounced to a sign-in form that cannot explain itself.
 *
 * All three carry `layoutWhenSignedOut: "auth"` because `AppShell` calls `useModulesQuery()`
 * unconditionally: rendering it without a session means a guaranteed 401 firing behind a page whose
 * entire job is to stay legible when things are broken. Signed IN, they keep the normal shell —
 * somebody who mistyped a URL wants the sidebar to click their way back out of it.
 *
 * ⚠ `/error` and `/maintenance` are reachable by URL and by nothing else, deliberately. Routing to
 * them automatically needs either a global error boundary or a health poll, and G1 decided neither.
 */
export const systemRoutes: RouteRecordRaw[] = [
  {
    path: "/error",
    name: "server-error",
    component: () => import("@/pages/ServerErrorPage.vue"),
    meta: { public: true, layoutWhenSignedOut: "auth", title: "Something went wrong" },
  },
  {
    path: "/maintenance",
    name: "maintenance",
    component: () => import("@/pages/MaintenancePage.vue"),
    meta: { public: true, layoutWhenSignedOut: "auth", title: "Down for maintenance" },
  },
];

/**
 * Separate from the list above, and exported separately, because it is the one route whose POSITION
 * is load-bearing: `/:pathMatch(.*)*` matches every URL there is. Composed last in `../index.ts`,
 * after every real area. Keeping it out of `systemRoutes` means it cannot be swept into the middle
 * of the table by somebody tidying the composition.
 */
export const notFoundRoute: RouteRecordRaw = {
  path: "/:pathMatch(.*)*",
  name: "not-found",
  component: () => import("@/pages/NotFoundPage.vue"),
  meta: { public: true, layoutWhenSignedOut: "auth", title: "Page not found" },
};
