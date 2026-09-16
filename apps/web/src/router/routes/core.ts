import type { RouteRecordRaw } from "vue-router";
import { tabIsWorkspace } from "@silvicom/shared";

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
    /**
     * D-DR24: this route is a DOCUMENT on most tabs and a WORKSPACE on the one holding the live map,
     * so its outlet is a question about the tab rather than about the route. The answer is the widget
     * catalogue's — `tabIsWorkspace` — and not a list of tab keys written here, which would be the
     * second home for a fact `dashboardWidgets.ts` already states.
     *
     * ⚠ The empty tab is the default tab, and the default tab is per ROLE, so it cannot be answered
     * here. `DashboardPage` writes the resolved tab into `?tab=` as soon as it knows it, which is the
     * same trip that gives a reload its tab back.
     */
    meta: {
      requiresAuth: true,
      title: "Dashboard",
      fullBleed: (route) => tabIsWorkspace(String(route.query?.tab ?? "")),
    },
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
