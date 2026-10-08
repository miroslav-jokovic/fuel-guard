import type { RouteRecordRaw } from "vue-router";

/** Fuel: planning, the log, the money, the cards and the exceptions raised against them. */
export const fuelRoutes: RouteRecordRaw[] = [
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
    path: "/fuel-log",
    name: "fuel-log",
    component: () => import("@/pages/FuelLogPage.vue"),
    meta: { requiresAuth: true, title: "Fuel Log" },
  },
  /**
   * Fuel Costs (FS2, D-FSV1/D-FSV7) — one report, no tabs. It was Reconciliation, then Fuel Spend
   * (D-FX8) with three tabs; the path stays `/fuel-spend` so every link sent to it still opens it,
   * `?tab=` and `?grain=` included (both are now ignored).
   */
  {
    path: "/fuel-spend",
    name: "fuel-spend",
    component: () => import("@/pages/FuelCostsPage.vue"),
    meta: { requiresAuth: true, title: "Fuel Costs" },
  },
  {
    // Fuel Spend's Buy discipline tab, its own screen since the report lost its tabs (Q-FSV12).
    path: "/fuel-buy-discipline",
    name: "fuel-buy-discipline",
    component: () => import("@/pages/FuelBuyDisciplinePage.vue"),
    meta: { requiresAuth: true, title: "Buy discipline", parent: "/fuel-spend" },
  },
  {
    /**
     * Pilot invoices (FS3, D-FSV8). Checking a vendor bill was a drawer on Fuel Spend's Statements tab,
     * and what it found lived in that drawer until it closed. It is its own page now: the checks the
     * server recorded, newest week first, each one opening on what was found.
     *
     * A read surface under `section("fuel")` in the catalogue, like Findings and IFTA; the upload button
     * carries `manage`, as the API's POST routes do. `/fuel-reconciliation` keeps redirecting to
     * `/fuel-spend`: links to it carry the spend page's `?tab=&from=&to=` and were never links to a check.
     */
    path: "/fuel-invoices",
    name: "fuel-invoices",
    component: () => import("@/pages/FuelInvoicesPage.vue"),
    meta: { requiresAuth: true, title: "Pilot invoices" },
  },
  {
    path: "/fuel-invoices/:id",
    name: "fuel-invoice-check",
    component: () => import("@/pages/FuelInvoiceCheckPage.vue"),
    meta: { requiresAuth: true, title: "Invoice check", parent: "/fuel-invoices" },
  },
  {
    /**
     * Fuel problems (F02-F04 chunk 8c4): the fuel queue. It was the Findings inbox (C7b), and before
     * that `/fuel-spend/exceptions`; both old paths redirect below.
     *
     * It moved out from under `/fuel-spend` at C7b because it stopped being a spend surface, and it was
     * renamed at 8c4 because it stopped being only findings: card-fraud incidents (8c1) and short fills
     * sit in it beside the money findings, each opening its own drawer here (8c3). Alerts keeps
     * `/anomalies` for safety work (Q-F12 (b), ruled 2026-10-08); nothing about it redirects here.
     */
    path: "/fuel-problems",
    name: "fuel-problems",
    component: () => import("@/pages/FuelProblemsPage.vue"),
    // `requiresAuth` only, deliberately NOT `requiresManage`: the queue is a read surface, and a
    // controller checking what was recovered should not need permission to upload a statement. Moving
    // an item is gated on the API route, which is where the decision actually happens. ⚠ And the
    // per-KIND gate is applied per ROW by the API (Q-FUI1): a caller without `safety` is not refused
    // this page, they simply have no fill cases in it.
    meta: { requiresAuth: true, title: "Fuel problems" },
  },
  /**
   * Every link ever sent to the queue still opens it, the open drawer included (`?finding=`, `?case=`,
   * `?incident=` ride along with the rest of the query). ⚠ From the ledger's own old path `?status=` is
   * NOT translated into `?state=`: they name different vocabularies — `disputed` is a ledger status,
   * `working` is a queue state — and silently reinterpreting one as the other would make a forwarded
   * link show something its sender never saw. An old link lands on the default queue, which is the
   * same fallback the retired `?tab=` values take on the spend page.
   */
  { path: "/findings", redirect: (to) => ({ path: "/fuel-problems", query: to.query }) },
  { path: "/fuel-spend/exceptions", redirect: (to) => ({ path: "/fuel-problems", query: to.query }) },
  {
    path: "/ifta",
    name: "ifta",
    component: () => import("@/pages/IftaLedgerPage.vue"),
    // `requiresAuth` only, like the exception ledger: this is a read surface for a controller, who
    // should not need permission to upload a statement in order to see what the fleet owes Texas.
    meta: { requiresAuth: true, title: "IFTA" },
  },
  {
    // One ledger row opened: the trucks that drove in that jurisdiction and their miles there. The
    // quarter rides along as `?q=`, so the link the ledger opens is the link that can be forwarded.
    path: "/ifta/:jurisdiction",
    name: "ifta-jurisdiction",
    component: () => import("@/pages/IftaJurisdictionPage.vue"),
    meta: { requiresAuth: true, title: "IFTA jurisdiction", parent: "/ifta" },
  },
  // The old paths are kept forever, not for a deprecation window. This page exists to be sent to
  // somebody: links to it are in emails, in tickets, and in the `?tab=&from=&to=` form the filters
  // produce. `redirect` preserves the query string, so a link sent in June still opens on what its
  // sender was looking at.
  { path: "/fuel-reconciliation", redirect: "/fuel-spend" },
  { path: "/fuel-exceptions", redirect: "/fuel-spend/exceptions" },

  /**
   * FUEL-C4, D-FUI3 — `/import` is retired as a page and its three capabilities are drawers now:
   * the EFS backfill on Fuel Log, the price and locations uploads on Truck Stops, and Repair fuel
   * data on Settings → Data & sync. Nothing was deleted, and the section no longer has a page whose
   * title is a verb applied to a file format.
   *
   * A plain string redirect, unlike the two C2 added: this path carried no filters — it was a form,
   * not a list — so there is no query worth translating and nothing to name a tab with.
   */
  { path: "/import", redirect: "/fuel-log" },
  /**
   * FUEL-C2, D-FUI1 — Transactions and Rejections are tabs of the Fuel Log, not pages.
   *
   * A FUNCTION redirect rather than a string one, because these two paths carry filters. Every link
   * to them in a ticket or an email is of the form `/transactions?unit=654`, and the whole reason the
   * old paths are kept forever (see the note above) is that somebody is going to open one. A string
   * redirect preserves the query and would land that link on the Fills tab, showing a different set
   * of rows than the sender was looking at; naming the tab is what makes the redirect faithful
   * rather than merely non-broken.
   *
   * `?unit=` needs no translation: it is the shared truck filter on the merged page, chosen as a unit
   * number precisely because that is what these two feeds — and these two links — already carry.
   */
  { path: "/transactions", redirect: (to) => ({ path: "/fuel-log", query: { ...to.query, tab: "source" } }) },
  { path: "/rejections", redirect: (to) => ({ path: "/fuel-log", query: { ...to.query, tab: "declines" } }) },
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
];
