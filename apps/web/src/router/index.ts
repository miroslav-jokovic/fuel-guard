import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
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
  /**
   * H5b — the applicant's own form. Unauthenticated by necessity: they fill it in before they are
   * anyone, from an emailed link whose token IS the access control. `public: true` so the guard lets
   * them through without a session, and `noindex` because an application link is not a page for
   * crawlers even though a crawler could never hold a valid token.
   */
  {
    path: "/apply/:token",
    name: "driver-application",
    component: () => import("@/pages/ApplyPage.vue"),
    meta: { public: true, layout: "apply", title: "Driver application", noindex: true },
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
  {
    path: "/",
    name: "dashboard",
    component: () => import("@/pages/DashboardPage.vue"),
    meta: { requiresAuth: true, title: "Dashboard" },
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
    meta: {
      requiresAuth: true,
      requiresManage: true,
      title: "New Hazmat Load",
      parent: "/hazmat/loads",
    },
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
    // H-C2: Cargo-Tank Profiles page removed — tank capacity lives on the trailer (Fleet → Trailers).
    path: "/hazmat/settings/equipment",
    redirect: "/trailers",
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
    path: "/drivers/:id",
    name: "driver-detail",
    component: () => import("@/pages/DriverDetailPage.vue"),
    meta: { requiresAuth: true, title: "Driver" },
  },
  {
    path: "/compliance",
    name: "compliance",
    component: () => import("@/pages/CompliancePage.vue"),
    meta: { requiresAuth: true, title: "Driver Qualification" },
  },
  {
    // D1/D2: the qualification file became a SECTION of the driver detail page — one driver, one
    // page. This redirect is load-bearing: bookmarks, the fleet table's links, notification deep
    // links and the binder's references all say /compliance/:id, and they all keep working.
    path: "/compliance/:id",
    name: "driver-qualification",
    redirect: (to) => ({
      name: "driver-detail",
      params: { id: to.params.id },
      query: { section: "qualification" },
    }),
  },
  {
    // Recruitment — the hiring side of §391, starting with the employment history the application
    // declares (§391.21(b)(10)) and the safety-history inquiries it obliges (§391.23(a)(2)).
    path: "/recruitment",
    name: "recruitment",
    component: () => import("@/pages/RecruitmentPage.vue"),
    meta: { requiresAuth: true, title: "Applicants" },
  },
  {
    // P0b. Shipped 2026-08-20 without this record — the page, its API and the applicant board's
    // button all existed while the URL fell through to nothing, which kept the DOB import (the fix
    // for a fleet with zero screenable drivers) unreachable. Registered 2026-08-20.
    path: "/recruitment/screening",
    name: "screening-readiness",
    component: () => import("@/pages/ScreeningReadinessPage.vue"),
    meta: { requiresAuth: true, title: "Screening Readiness", parent: "/recruitment" },
  },
  {
    // E5 — the §391.23 queue, led by our §391.23(c)(1) deadline. Same omission as above, same day.
    path: "/recruitment/inquiries",
    name: "inquiry-queue",
    component: () => import("@/pages/InquiryQueuePage.vue"),
    meta: { requiresAuth: true, title: "Inquiry Queue", parent: "/recruitment" },
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
    // Read is open to every fuel-viewing role; the write actions gate themselves from the
    // server-computed `capabilities`, which the browser cannot work out on its own.
    path: "/fuel-cards",
    name: "fuel-cards",
    component: () => import("@/pages/FuelCardsPage.vue"),
    meta: { requiresAuth: true, title: "Fuel Cards" },
  },
  {
    path: "/fuel-cards/:id",
    name: "fuel-card-detail",
    component: () => import("@/pages/FuelCardDetailPage.vue"),
    meta: { requiresAuth: true, title: "Fuel Card", parent: "/fuel-cards" },
  },
  {
    path: "/settings/card-control",
    name: "card-control-settings",
    component: () => import("@/pages/CardControlSettingsPage.vue"),
    // Admin only: this page decides whether this company may change fuel cards at all, and running
    // the check sends a real setCardV2 to a real card.
    meta: { requiresAuth: true, requiresAdmin: true, title: "Card control", parent: "/settings" },
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
    meta: {
      requiresAuth: true,
      requiresAdmin: true,
      title: "Anomaly Thresholds",
      parent: "/settings",
    },
  },
  {
    path: "/settings/driver-performance",
    name: "driver-performance-settings",
    component: () => import("@/pages/DriverPerformanceSettingsPage.vue"),
    meta: {
      requiresAuth: true,
      requiresAdmin: true,
      title: "Driver Performance",
      parent: "/settings",
    },
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
    meta: {
      requiresAuth: true,
      requiresAdmin: true,
      title: "Planned Fueling",
      parent: "/settings",
    },
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
    meta: {
      requiresAuth: true,
      requiresAdmin: true,
      title: "EFS Integration",
      parent: "/settings",
    },
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
    meta: {
      requiresAuth: true,
      requiresAuditAccess: true,
      title: "Audit Log",
      parent: "/settings",
    },
  },
];

const designSystemLabEnabled =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_DESIGN_SYSTEM_LAB === "true";

if (designSystemLabEnabled) {
  routes.unshift({
    path: "/__design-system",
    name: "design-system-lab",
    component: () => import("@/dev/DesignSystemLabPage.vue"),
    meta: { public: true, layout: "lab", title: "Design system lab" },
  });
}

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  if (designSystemLabEnabled && to.meta.layout === "lab") return true;
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
  if (to.name === "login" || to.name === "pending" || to.name === "driver-app")
    return { name: "dashboard" };
  if (to.meta.requiresAdmin && !session.admin) return { name: "dashboard" };
  if (to.meta.requiresManage && !session.canManage) return { name: "dashboard" };
  if (to.meta.requiresAuditAccess && !(session.admin || session.readOnly))
    return { name: "dashboard" };
  return true;
});
