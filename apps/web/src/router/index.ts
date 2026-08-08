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
  // M7 — free public placard calculator (unauthenticated, indexable; its own layout).
  {
    path: "/placard-calculator",
    name: "public-placard-calculator",
    component: () => import("@/pages/PublicPlacardCalculatorPage.vue"),
    meta: { public: true, layout: "public", title: "Free DOT Placard Calculator" },
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
  {
    // Drivers are redirected here — they use the Driver app, not the web dashboard.
    path: "/use-the-app",
    name: "driver-app",
    component: () => import("@/pages/auth/DriverAppRedirectPage.vue"),
    meta: { requiresAuth: true, layout: "auth" },
  },

  // App pages (require auth + org membership).
  { path: "/", name: "dashboard", component: DashboardPage, meta: { requiresAuth: true, title: "Dashboard" } },
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
    meta: { requiresAuth: true, requiresManage: true, title: "New Load" },
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
  {
    path: "/hazmat",
    name: "hazmat",
    component: () => import("@/pages/HazmatPage.vue"),
    meta: { requiresAuth: true, title: "HazmatGuard" },
  },
  {
    path: "/hazmat/calculator",
    name: "hazmat-calculator",
    component: () => import("@/pages/HazmatCalculatorPage.vue"),
    meta: { requiresAuth: true, title: "Placard Calculator", parent: "/hazmat" },
  },
  {
    path: "/hazmat/loads",
    name: "hazmat-loads",
    component: () => import("@/pages/HazmatLoadsPage.vue"),
    meta: { requiresAuth: true, title: "Hazmat Loads", parent: "/hazmat" },
  },
  {
    path: "/hazmat/loads/new",
    name: "hazmat-load-new",
    component: () => import("@/pages/HazmatLoadFormPage.vue"),
    meta: { requiresAuth: true, requiresManage: true, title: "New Hazmat Load", parent: "/hazmat/loads" },
  },
  {
    path: "/hazmat/loads/:id",
    name: "hazmat-load-detail",
    component: () => import("@/pages/HazmatLoadDetailPage.vue"),
    meta: { requiresAuth: true, title: "Hazmat Load", parent: "/hazmat/loads" },
  },
  {
    path: "/hazmat/review",
    name: "hazmat-review",
    component: () => import("@/pages/HazmatReviewPage.vue"),
    meta: { requiresAuth: true, title: "Hazmat Review", parent: "/hazmat" },
  },
  {
    path: "/hazmat/settings/equipment",
    name: "hazmat-equipment",
    component: () => import("@/pages/HazmatEquipmentPage.vue"),
    meta: { requiresAuth: true, requiresManage: true, title: "Cargo-Tank Profiles", parent: "/hazmat" },
  },
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
    path: "/odometer",
    name: "odometer",
    component: () => import("@/pages/OdometerPage.vue"),
    meta: { requiresAuth: true, title: "Odometer Mismatches" },
  },
  {
    path: "/coverage",
    name: "coverage",
    component: () => import("@/pages/CoveragePage.vue"),
    meta: { requiresAuth: true, title: "Detection Coverage", parent: "/settings" },
  },
  {
    path: "/recall-audit",
    name: "recall-audit",
    component: () => import("@/pages/RecallAuditPage.vue"),
    meta: { requiresAuth: true, title: "Recall Audit", parent: "/settings" },
  },
  {
    path: "/trailers",
    name: "trailers",
    component: () => import("@/pages/TrailersPage.vue"),
    meta: { requiresAuth: true, title: "Trailers" },
  },
  {
    path: "/reefer-coverage",
    name: "reefer-coverage",
    component: () => import("@/pages/ReeferCoveragePage.vue"),
    meta: { requiresAuth: true, title: "Reefer Coverage", parent: "/settings" },
  },
  {
    path: "/fuel-planning",
    name: "fuel-planning",
    component: () => import("@/pages/FuelPlanningPage.vue"),
    meta: { requiresAuth: true, title: "Fuel Planning" },
  },
  {
    path: "/truck-stops",
    name: "truck-stops",
    component: () => import("@/pages/FuelStationsPage.vue"),
    meta: { requiresAuth: true, title: "Truck Stops" },
  },
  {
    path: "/idling",
    name: "idling",
    component: () => import("@/pages/IdlingPage.vue"),
    meta: { requiresAuth: true, title: "Idling" },
  },
  {
    path: "/drivers",
    name: "drivers",
    component: () => import("@/pages/DriversPage.vue"),
    meta: { requiresAuth: true, title: "Drivers" },
  },
  {
    path: "/compliance",
    name: "compliance",
    component: () => import("@/pages/CompliancePage.vue"),
    meta: { requiresAuth: true, title: "Driver Qualification" },
  },
  {
    path: "/driver-performance",
    name: "driver-performance",
    component: () => import("@/pages/DriverPerformancePage.vue"),
    meta: { requiresAuth: true, title: "Driver Performance" },
  },
  {
    path: "/fuel-log",
    name: "fuel-log",
    component: () => import("@/pages/FuelLogPage.vue"),
    meta: { requiresAuth: true, title: "Fuel Log" },
  },
  {
    path: "/fuel-reconciliation",
    name: "fuel-reconciliation",
    component: () => import("@/pages/FuelReconciliationPage.vue"),
    meta: { requiresAuth: true, requiresManage: true, title: "Fuel Reconciliation" },
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
    meta: { requiresAuth: true, title: "Alerts" },
  },
  {
    // Merged into Fuel Log (same underlying fuel_transactions data) — redirect old links.
    path: "/fuel-events",
    redirect: "/fuel-log",
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
    path: "/settings",
    name: "settings",
    component: () => import("@/pages/SettingsPage.vue"),
    meta: { requiresAuth: true, requiresManage: true, title: "Settings" },
  },
  {
    path: "/settings/users",
    name: "users",
    component: () => import("@/pages/SettingsUsersPage.vue"),
    meta: { requiresAuth: true, requiresAdmin: true, title: "Users", parent: "/settings" },
  },
  {
    path: "/settings/thresholds",
    name: "thresholds",
    component: () => import("@/pages/ThresholdsPage.vue"),
    meta: { requiresAuth: true, requiresAdmin: true, title: "Anomaly Thresholds", parent: "/settings" },
  },
  {
    path: "/settings/driver-performance",
    name: "driver-performance-settings",
    component: () => import("@/pages/DriverPerformanceSettingsPage.vue"),
    meta: { requiresAuth: true, requiresAdmin: true, title: "Driver Performance", parent: "/settings" },
  },
  {
    // Dispatch inbox (Phase 7, D-PM4). View access mirrors the nav gate: dispatch section, any
    // view role — participation + the module gate are the real boundary server-side.
    path: "/messages",
    name: "messages",
    component: () => import("@/pages/MessagesPage.vue"),
    meta: { requiresAuth: true, title: "Messages" },
  },
  {
    // Driver-app control plane (hardening plan Phase 5, D-PM6): requiresManage = canManageFleet
    // (admin + fleet_manager) — org-wide app policy is fleet management, not org administration.
    path: "/settings/driver-app",
    name: "driver-app-settings",
    component: () => import("@/pages/DriverAppSettingsPage.vue"),
    meta: { requiresAuth: true, requiresManage: true, title: "Driver App", parent: "/settings" },
  },
  {
    path: "/settings/fuel-planning",
    name: "fuel-planning-settings",
    component: () => import("@/pages/FuelPlanningSettingsPage.vue"),
    meta: { requiresAuth: true, requiresAdmin: true, title: "Planned Fueling", parent: "/settings" },
  },
  {
    path: "/settings/data",
    name: "data-sync",
    component: () => import("@/pages/DataSyncPage.vue"),
    meta: { requiresAuth: true, requiresManage: true, title: "Data & Sync", parent: "/settings" },
  },
  {
    path: "/settings/efs-soap",
    name: "efs-soap",
    component: () => import("@/pages/EfsSoapPage.vue"),
    meta: { requiresAuth: true, requiresAdmin: true, title: "EFS Integration", parent: "/settings" },
  },
  {
    path: "/settings/org",
    name: "org-settings",
    component: () => import("@/pages/OrgSettingsPage.vue"),
    meta: { requiresAuth: true, requiresAdmin: true, title: "Organization", parent: "/settings" },
  },
  {
    path: "/settings/notifications",
    name: "notifications",
    component: () => import("@/pages/NotificationsPage.vue"),
    meta: { requiresAuth: true, requiresAdmin: true, title: "Notifications", parent: "/settings" },
  },
  {
    path: "/settings/audit",
    name: "audit",
    component: () => import("@/pages/AuditPage.vue"),
    meta: { requiresAuth: true, requiresAuditAccess: true, title: "Audit Log", parent: "/settings" },
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
  // Drivers use the Driver app; they may not use the web dashboard (Driver App, Phase 1).
  if (session.role === "driver") {
    return to.name === "driver-app" ? true : { name: "driver-app" };
  }
  // Authenticated with an org.
  if (to.name === "login" || to.name === "pending" || to.name === "driver-app") return { name: "dashboard" };
  if (to.meta.requiresAdmin && !session.admin) return { name: "dashboard" };
  if (to.meta.requiresManage && !session.canManage) return { name: "dashboard" };
  if (to.meta.requiresAuditAccess && !(session.admin || session.readOnly)) return { name: "dashboard" };
  return true;
});
