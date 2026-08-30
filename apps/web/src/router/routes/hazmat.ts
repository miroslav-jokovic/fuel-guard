import type { RouteRecordRaw } from "vue-router";

/**
 * HazmatGuard. Gated on the `hazmatguard` module as well as the role (see `lib/nav.ts`).
 *
 * D-H15/D-H17 (owner, 2026-08-30): there is ONE loads page, and it is Dispatch's. `loads` already
 * carries the hazmat determination — McLeod will supply it once the TMS integration lands — and the
 * dispatch load's own Hazmat section (H-C1) is the record's front door. The parallel hazmat board,
 * its create form and the hub that linked to them are gone; what remains here are the two surfaces
 * that duplicate nothing: the calculator, which is a tool with no other home, and the review queue,
 * which is a §172 work queue for a tighter role set than dispatch (D6).
 *
 * The deleted paths REDIRECT rather than 404: they are in notification links, in bookmarks and in
 * `routeTable.test.ts`, and a redirect keeps every one of those promises while still leaving exactly
 * one place to look.
 */
export const hazmatRoutes: RouteRecordRaw[] = [
  // The hub is gone (D-H15) — three of its four cards pointed at surfaces that already existed.
  { path: "/hazmat", redirect: "/hazmat/calculator" },
  {
    path: "/hazmat/calculator",
    name: "hazmat-calculator",
    component: () => import("@/pages/HazmatCalculatorPage.vue"),
    meta: { requiresAuth: true, title: "Placard Calculator" },
  },
  {
    path: "/hazmat/review",
    name: "hazmat-review",
    component: () => import("@/pages/HazmatReviewPage.vue"),
    meta: { requiresAuth: true, title: "Hazmat Review" },
  },
  // D-H17: the second board and the create path that orphaned its records. These sit BEFORE the
  // workspace's `:id` route on purpose — vue-router ranks a static segment above a dynamic one, but
  // declaration order is the version of that guarantee a reader can check without knowing the
  // ranking rules, and `/hazmat/loads/new` resolving as a load id would 404 on a bookmark.
  { path: "/hazmat/loads/new", redirect: "/loads" },
  { path: "/hazmat/loads", redirect: "/loads" },
  {
    /**
     * The WORKSPACE — the deep evidence surface (declaration, runs, documents, review,
     * reproducibility). It is reached from the dispatch load and from the review queue, never from a
     * board of its own, so its breadcrumb parent is the Loads board itself (`/loads` — `/dispatch/loads`
     * is an alias redirect with no title of its own, which the G2 breadcrumb gate catches).
     */
    path: "/hazmat/loads/:id",
    name: "hazmat-load-detail",
    component: () => import("@/pages/HazmatLoadDetailPage.vue"),
    meta: { requiresAuth: true, title: "Hazmat Load", parent: "/loads" },
  },
  // H-C2: Cargo-Tank Profiles page removed — tank capacity lives on the trailer (Fleet → Trailers).
  { path: "/hazmat/settings/equipment", redirect: "/trailers" },
];
