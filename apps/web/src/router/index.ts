import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import DashboardPage from "@/pages/DashboardPage.vue";
import { useSessionStore } from "@/stores/session";

const routes: RouteRecordRaw[] = [
  // Auth (public / no-org) pages — rendered in the centered AuthLayout.
  {
    path: "/login",
    name: "login",
    component: () => import("@/pages/auth/LoginPage.vue"),
    meta: { public: true, layout: "auth" },
  },
  {
    path: "/accept-invite",
    name: "accept-invite",
    component: () => import("@/pages/auth/AcceptInvitePage.vue"),
    meta: { requiresAuth: true, allowNoOrg: true, layout: "auth" },
  },
  {
    path: "/pending",
    name: "pending",
    component: () => import("@/pages/auth/PendingPage.vue"),
    meta: { requiresAuth: true, allowNoOrg: true, layout: "auth" },
  },

  // App pages (require auth + org membership).
  { path: "/", name: "dashboard", component: DashboardPage, meta: { requiresAuth: true, title: "Dashboard" } },
  {
    path: "/vehicles",
    name: "vehicles",
    component: () => import("@/pages/VehiclesPage.vue"),
    meta: { requiresAuth: true, title: "Vehicles" },
  },
  {
    path: "/vehicles/:id",
    name: "vehicle-detail",
    component: () => import("@/pages/VehicleDetailPage.vue"),
    meta: { requiresAuth: true, title: "Vehicle" },
  },
  {
    path: "/drivers",
    name: "drivers",
    component: () => import("@/pages/DriversPage.vue"),
    meta: { requiresAuth: true, title: "Drivers" },
  },
  {
    path: "/fuel-log",
    name: "fuel-log",
    component: () => import("@/pages/FuelLogPage.vue"),
    meta: { requiresAuth: true, title: "Fuel Log" },
  },
  {
    path: "/import",
    name: "import",
    component: () => import("@/pages/ImportPage.vue"),
    meta: { requiresAuth: true, requiresManage: true, title: "Import EFS Report" },
  },
  {
    path: "/transactions",
    name: "transactions",
    component: () => import("@/pages/TransactionsPage.vue"),
    meta: { requiresAuth: true, title: "Transactions" },
  },
  {
    path: "/rejections",
    name: "rejections",
    component: () => import("@/pages/RejectionsPage.vue"),
    meta: { requiresAuth: true, title: "Rejections" },
  },
  {
    path: "/anomalies",
    name: "anomalies",
    component: () => import("@/pages/AnomaliesPage.vue"),
    meta: { requiresAuth: true, title: "Anomalies" },
  },
  {
    path: "/fuel-events",
    name: "fuel-events",
    component: () => import("@/pages/FuelEventsPage.vue"),
    meta: { requiresAuth: true, title: "Fuel Events" },
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
    meta: { requiresAuth: true, title: "Reports" },
  },
  {
    path: "/settings",
    name: "settings",
    component: () => import("@/pages/SettingsPage.vue"),
    meta: { requiresAuth: true, requiresManage: true, title: "Settings" },
  },
  {
    path: "/settings/users",
    name: "users",
    component: () => import("@/pages/SettingsUsersPage.vue"),
    meta: { requiresAuth: true, requiresAdmin: true, title: "Users" },
  },
  {
    path: "/settings/thresholds",
    name: "thresholds",
    component: () => import("@/pages/ThresholdsPage.vue"),
    meta: { requiresAuth: true, requiresAdmin: true, title: "Anomaly Thresholds" },
  },
  {
    path: "/settings/org",
    name: "org-settings",
    component: () => import("@/pages/OrgSettingsPage.vue"),
    meta: { requiresAuth: true, requiresAdmin: true, title: "Organization" },
  },
  {
    path: "/settings/audit",
    name: "audit",
    component: () => import("@/pages/AuditPage.vue"),
    meta: { requiresAuth: true, requiresAuditAccess: true, title: "Audit Log" },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const session = useSessionStore();
  if (!session.initialized) await session.init();

  if (!session.isAuthenticated) {
    return to.meta.public ? true : { name: "login" };
  }
  // Authenticated but no membership yet (audit B3) → only no-org auth pages allowed.
  if (!session.hasOrg) {
    return to.meta.allowNoOrg ? true : { name: "pending" };
  }
  // Authenticated with an org.
  if (to.name === "login" || to.name === "pending") return { name: "dashboard" };
  if (to.meta.requiresAdmin && !session.admin) return { name: "dashboard" };
  if (to.meta.requiresManage && !session.canManage) return { name: "dashboard" };
  if (to.meta.requiresAuditAccess && !(session.admin || session.readOnly)) return { name: "dashboard" };
  return true;
});
