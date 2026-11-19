import type { RouteRecordRaw } from "vue-router";

/**
 * The Ads workspace (ADS-PLATFORM-V2-PLAN V6; Q-APX18 (a), owner 2026-11-18): one sidebar entry, five tabs. The gate
 * of each is its surface's (`ads.*`, and `admin.recruiting.ads` for Settings), read by the router guard, never
 * written here.
 *
 * The two addresses the ads lived at before redirect, so a bookmark or a notification link still lands: the
 * campaigns tab kept its `?campaign=` drawer, and a vue-router redirect carries the query across (memory
 * "vue-router redirect keeps the query"; pinned by "the old campaigns address keeps the open campaign").
 */
export const adsRoutes: RouteRecordRaw[] = [
  {
    path: "/ads",
    name: "ads-overview",
    component: () => import("@/pages/AdsOverviewPage.vue"),
    // The sidebar entry's label, as every entry's page title is (D-SB5, `nav.test.ts`); the group above it says "Ads".
    meta: { requiresAuth: true, title: "Overview" },
  },
  {
    path: "/ads/campaigns",
    name: "ads-campaigns",
    component: () => import("@/pages/AdsCampaignsPage.vue"),
    meta: { requiresAuth: true, title: "Campaigns", parent: "/ads" },
  },
  {
    path: "/ads/studio",
    name: "ads-studio",
    component: () => import("@/pages/AdsStudioPage.vue"),
    meta: { requiresAuth: true, title: "Creative studio", parent: "/ads" },
  },
  {
    path: "/ads/automation",
    name: "ads-automation",
    component: () => import("@/pages/AdsAutomationPage.vue"),
    meta: { requiresAuth: true, title: "Automation", parent: "/ads" },
  },
  {
    // Settings › Ads control until 2026-11-18. The name stays, so every `{ name: "ads-control-settings" }` still
    // resolves; the surface key stays too (`surfaceCatalogue.ts` says why).
    path: "/ads/settings",
    name: "ads-control-settings",
    component: () => import("@/pages/AdsControlPage.vue"),
    meta: { requiresAuth: true, title: "Settings", parent: "/ads" },
  },
  { path: "/recruitment/campaigns", redirect: { name: "ads-campaigns" } },
  { path: "/settings/recruiting/ads", redirect: { name: "ads-control-settings" } },
];
