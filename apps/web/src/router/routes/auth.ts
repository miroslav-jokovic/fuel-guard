import type { RouteRecordRaw } from "vue-router";

/**
 * Signing in, and the three surfaces reachable without an account.
 *
 * Everything here is `public: true` or `allowNoOrg: true`, which is the whole reason the area is
 * its own file: these are the records the guard in `../index.ts` reads before a session exists, and
 * a mistake in one of them is reachable by anyone on the internet.
 */
export const authRoutes: RouteRecordRaw[] = [
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
  /**
   * The invited user's landing page. `public: true` since 2026-09-02, and that is the fix rather
   * than a side effect of one: it was `requiresAuth: true`, so the guard above converted EVERY way
   * an invite link can fail — spent by a mail scanner, expired, or simply carrying a `token_hash`
   * the client had not redeemed yet — into a silent redirect to /login. The page's own "link
   * expired" branch could never render, because the guard ran first.
   *
   * Nothing is exposed by making it public. Since 2026-09-04 the page holds no GoTrue credential at
   * all: the link carries the invitation's own token, the page READS it through
   * `POST /api/public/invites/lookup` and spends it only with a password through
   * `POST /api/public/invites/redeem`, and the API creates the login and the membership before the
   * page signs in. The session that sign-in produces already carries the org and role.
   *
   * `allowNoOrg` stays for the moment between sign-in and navigation, when the store may still hold
   * a session whose claims it has not yet read.
   */
  {
    path: "/accept-invite",
    name: "accept-invite",
    component: () => import("@/pages/auth/AcceptInvitePage.vue"),
    meta: { public: true, allowNoOrg: true, layout: "auth" },
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
];
