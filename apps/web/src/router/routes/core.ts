import type { RouteRecordRaw } from "vue-router";

/**
 * The dashboard and the three cross-cutting surfaces that belong to no single area — Ask AI,
 * Reports and Messages each read from several of them.
 */
export const coreRoutes: RouteRecordRaw[] = [

  // App pages (require auth + org membership).
  {
    path: "/",
    name: "dashboard",
    component: () => import("@/pages/DashboardPage.vue"),
    meta: { requiresAuth: true, title: "Dashboard" },
  },
  {
    path: "/ask",
    name: "ask",
    component: () => import("@/pages/AskAiPage.vue"),
    meta: { requiresAuth: true, title: "Ask AI" },
  },
  {
    path: "/reports",
    name: "reports",
    component: () => import("@/pages/ReportsPage.vue"),
    meta: { requiresAuth: true, title: "Reports", parent: "/settings" },
  },
  {
    // Dispatch inbox (Phase 7, D-PM4). View access mirrors the nav gate: dispatch section, any
    // view role — participation + the module gate are the real boundary server-side.
    path: "/messages",
    name: "messages",
    component: () => import("@/pages/MessagesPage.vue"),
    meta: { requiresAuth: true, title: "Messages" },
  },
];
