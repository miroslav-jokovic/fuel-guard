import type { RouteRecordRaw } from "vue-router";

/** Assignments and loads, including the `/dispatch/loads` aliases (LD2). */
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
