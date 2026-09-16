import type { RouteRecordRaw } from "vue-router";

/** Assignments, loads and the live map, including the `/dispatch/loads` aliases (LD2). */
export const dispatchRoutes: RouteRecordRaw[] = [
  {
    // LM8. `section("dispatch")` in the catalogue, not `manage` — the API gates
    // `requireSection("dispatch", "view")` and an auditor holds it, so a stricter surface would hide
    // a page from somebody the endpoint will happily answer.
    path: "/live-map",
    name: "live-map",
    component: () => import("@/pages/LiveMapPage.vue"),
    // D-DR5: the map IS the page, so the shell's padded document outlet would be a frame around a
    // workspace. `fullBleed` drops the gutters and gives `<main>` a height; the sidebar, top bar and
    // bell are untouched. It is NOT `layout`, which means "a different shell entirely".
    meta: { requiresAuth: true, title: "Live map", fullBleed: true },
  },
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
  {
    path: "/loads/new",
    name: "load-new",
    component: () => import("@/pages/DispatchLoadsPage.vue"),
    meta: { requiresAuth: true, title: "New Load" },
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
    redirect: { name: "load-new" },
  },
  {
    path: "/dispatch/loads/:id",
    redirect: (to) => ({ name: "load-detail", params: { id: to.params.id } }),
  },
];
