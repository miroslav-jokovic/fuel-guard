import type { RouteRecordRaw } from "vue-router";

/**
 * Assignments and loads, including the `/dispatch/loads` aliases (LD2).
 *
 * ── `/live-map` IS GONE, AND IT IS NOT AN OVERSIGHT (D-DR24, 2026-09-16) ─────────────────────────
 * It was here, full-bleed, rendering the same board the Dashboard's Dispatch tab renders. Owner's
 * ruling: one live map, and the tab is the survivor — so the route, its page and its sidebar entry
 * went with it rather than being left as a second door onto one surface. `fullBleed` did not go with
 * them: the Dispatch tab is a `workspace` widget and the dashboard route asks the catalogue for the
 * same treatment, which is why `meta.fullBleed` now takes a predicate.
 *
 * ⚠ Anyone arriving on a bookmarked `/live-map` lands on the router's not-found handling. That is
 * the accepted cost of the ruling and not a defect to "fix" with a redirect that would keep the URL
 * alive for another year — but if bookmarks turn out to matter, a redirect to `/?tab=dispatch` is
 * the two-line answer.
 */
export const dispatchRoutes: RouteRecordRaw[] = [
  {
    path: "/assignments",
    name: "assignments",
    component: () => import("@/pages/AssignmentsPage.vue"),
    meta: { requiresAuth: true, title: "Assignments" },
  },
  {
    path: "/loads",
    name: "loads",
    component: () => import("@/pages/DispatchLoadsPage.vue"),
    meta: { requiresAuth: true, title: "Loads" },
  },
  // The create form went in LR6 (LOADS-MIRROR-PLAN.md, Q-LMR7): every load is McLeod's. The PATH stays
  // as a redirect, the way `/hazmat/loads/new` did (D-H17): without it a bookmark would fall through to
  // `/loads/:id` with the id "new" and read "That load no longer exists".
  {
    path: "/loads/new",
    redirect: { name: "loads" },
  },
  {
    path: "/loads/:id",
    name: "load-detail",
    // A real page, not the board with a drawer over it (LD2). `parent` gives AppShell the back chevron.
    component: () => import("@/pages/DispatchLoadDetailPage.vue"),
    meta: { requiresAuth: true, title: "Load Details", parent: "/loads" },
  },
  {
    path: "/dispatch/loads",
    redirect: { name: "loads" },
  },
  {
    path: "/dispatch/loads/new",
    redirect: { name: "loads" },
  },
  {
    path: "/dispatch/loads/:id",
    redirect: (to) => ({ name: "load-detail", params: { id: to.params.id } }),
  },
];
