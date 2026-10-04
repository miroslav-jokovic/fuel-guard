import type { RouteRecordRaw } from "vue-router";

/**
 * Settings, and the org-level configuration that lives under it.
 *
 * Every route here is a surface in `surfaceCatalogue.ts` since SP1 (SETTINGS-PERMISSIONS-PLAN.md),
 * and the guard in `../index.ts` reads its gate from there. `requiresAdmin` stays only on the four
 * screens Q-SET1 keeps admin-only — Users, Permissions, Card control, EFS integration — where the
 * catalogue's `ADMIN` gate says the same; the rest are permissions an admin can give per role or
 * per person, and start off for everyone who could not open them before (Q-SET2).
 */
export const settingsRoutes: RouteRecordRaw[] = [
  {
    path: "/settings/card-control",
    name: "card-control-settings",
    component: () => import("@/pages/CardControlSettingsPage.vue"),
    // Admin only: this page decides whether this company may change fuel cards at all, and running
    // the check sends a real setCardV2 to a real card.
    meta: { requiresAuth: true, requiresAdmin: true, title: "Card control", parent: "/settings" },
  },
  {
    /**
     * No section meta, and that is not an omission (S2). `admin.settings` in the surface catalogue
     * says `settings: view`, and the guard reads it — one home for the fact instead of two.
     *
     * The two-homes version of this route is the reason S2 exists. It asked `manage` while the
     * sidebar offered it on `view`, and `auditor` is the only role holding `settings: "view"`
     * without `manage`, so an auditor saw a Settings entry that bounced them to the dashboard — a
     * menu item that never worked for the one role it was added for (Q-SURF5, fixed 2026-09-02).
     * `auth.ts` says the page was meant to be reachable by them: "the audit log card is on this
     * page and a read-only reviewer is its reader".
     */
    path: "/settings",
    name: "settings",
    component: () => import("@/pages/SettingsPage.vue"),
    meta: { requiresAuth: true, title: "Settings" },
  },
  {
    path: "/settings/users",
    name: "users",
    component: () => import("@/pages/SettingsUsersPage.vue"),
    meta: { requiresAuth: true, requiresAdmin: true, title: "Users", parent: "/settings" },
  },
  {
    // EDITABLE-PERMISSIONS-PLAN.md P0. The matrix existed only as a collapsed panel at the foot of
    // /settings/users — no route, no nav entry, no title — which is why the owner reported the
    // product as having no permissions page at all. `requiresAdmin` matches Users: who may see
    // whom, and with what access, is org administration.
    path: "/settings/permissions",
    name: "permissions",
    component: () => import("@/pages/SettingsPermissionsPage.vue"),
    meta: { requiresAuth: true, requiresAdmin: true, title: "Permissions", parent: "/settings" },
  },
  {
    // R1 (APPLICATION-FLOW-V2-PLAN.md, Q-AW42): the carrier's Representatives and road-test examiners.
    // No section meta: `admin.recruiting` in the surface catalogue says `recruitment: view`, and the
    // guard reads it — so a recruiter, who holds `settings: none`, still reaches it by URL. It lives
    // under Settings (a card there, no sidebar entry — owner's ruling 2026-09-28), so its crumb is
    // Settings like its neighbours'.
    path: "/settings/recruiting",
    name: "recruiting-settings",
    component: () => import("@/pages/SettingsRecruitingPage.vue"),
    meta: { requiresAuth: true, title: "Recruiting", parent: "/settings" },
  },
  {
    path: "/settings/thresholds",
    name: "thresholds",
    component: () => import("@/pages/ThresholdsPage.vue"),
    meta: {
      requiresAuth: true,
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
      title: "Driver Performance",
      parent: "/settings",
    },
  },
  {
    // Driver-app control plane (hardening plan Phase 5, D-PM6). `roster` and not `settings`: this
    // console decides what DRIVERS see. The catalogue gates the screen on `roster: manage`, and its
    // API half (driverAppSettings.ts) asks the same question with `requireSection("roster")` for the
    // org settings and the closure queue — the ORG's matrix, not the shipped one. The per-driver
    // exceptions tab writes through `requireSection("dispatch")` instead, a separate section (SP5
    // corrected this comment, which named `rolesThatManage("roster")` and "admin + fleet_manager").
    path: "/settings/driver-app",
    name: "driver-app-settings",
    component: () => import("@/pages/DriverAppSettingsPage.vue"),
    meta: { requiresAuth: true, title: "Driver App", parent: "/settings" },
  },
  {
    path: "/settings/fuel-planning",
    name: "fuel-planning-settings",
    component: () => import("@/pages/FuelPlanningSettingsPage.vue"),
    meta: {
      requiresAuth: true,
      title: "Planned Fueling",
      parent: "/settings",
    },
  },
  {
    path: "/settings/data",
    name: "data-sync",
    component: () => import("@/pages/DataSyncPage.vue"),
    meta: { requiresAuth: true, title: "Data & Sync", parent: "/settings" },
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
    path: "/settings/fleetpal",
    name: "fleetpal-settings",
    component: () => import("@/pages/FleetpalSettingsPage.vue"),
    meta: {
      requiresAuth: true,
      requiresAdmin: true,
      title: "FleetPal Integration",
      parent: "/settings",
    },
  },
  {
    path: "/settings/org",
    name: "org-settings",
    component: () => import("@/pages/OrgSettingsPage.vue"),
    meta: { requiresAuth: true, title: "Organization", parent: "/settings" },
  },
  {
    path: "/settings/notifications",
    name: "notifications",
    component: () => import("@/pages/NotificationsPage.vue"),
    meta: { requiresAuth: true, title: "Notifications", parent: "/settings" },
  },
  {
    path: "/settings/audit",
    name: "audit",
    component: () => import("@/pages/AuditPage.vue"),
    meta: {
      requiresAuth: true,
      title: "Audit Log",
      parent: "/settings",
    },
  },
];
