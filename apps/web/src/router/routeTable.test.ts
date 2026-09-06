import { describe, it, expect } from "vitest";
import { START_LOCATION } from "vue-router";
import { router } from "./index";

/**
 * The equivalence harness for the route-table split (UI-GAPS-PLAN.md §4's budget note).
 *
 * `router/index.ts` reached 480 of the 500-line budget with 64 routes in one array, and G1's three
 * dead-end routes pushed it to 514 — a hard `lint:filesize` failure. The table was therefore split
 * into `router/routes/*.ts` by area. That refactor is worth exactly nothing if it changes which
 * component a URL resolves to, and a route table is precisely the kind of code where a silent
 * reordering is invisible in review and catastrophic in production.
 *
 * So this test was written and its snapshots captured **against the unsplit table, before the split
 * touched anything**. A passing run after the split is the proof that nothing moved. Both snapshots
 * are committed; if either one changes, the diff shows exactly which URL now goes somewhere else.
 *
 * Two snapshots, because they catch different failures:
 *
 *   1. `route table` is sorted by path, so it is blind to declaration order on purpose. It answers
 *      "is every route still here, with the same name and the same meta?" — it catches a route
 *      dropped by a bad copy-paste, or a `requiresManage` lost in transit.
 *
 *   2. `resolution` is order-SENSITIVE by construction. vue-router v4 ranks by specificity rather
 *      than declaration order, so the two `/loads/new` vs `/loads/:id` style pairs below should be
 *      immune to reordering — but "should be" is not a thing to take on trust in the file that
 *      decides where every URL in the product lands. This snapshot makes the claim testable.
 *
 * ⚠ The design-system lab route is `unshift`ed onto the table when `import.meta.env.DEV`, which is
 * true under vitest. Its presence at the head of the table is expected here and absent in a
 * production build (`vite build` sets DEV false, and the lab needs VITE_ENABLE_DESIGN_SYSTEM_LAB).
 */

/** Every URL worth pinning: one per declared route, with the ambiguous pairs written out. */
const PROBES = [
  "/login", "/placard-calculator", "/apply/tok_123", "/accept-invite", "/pending", "/use-the-app",
  "/",
  "/assignments",
  // The pairs a specificity regression would break first: a static segment must beat a param.
  "/loads", "/loads/new", "/loads/ld_1",
  "/dispatch/loads", "/dispatch/loads/new", "/dispatch/loads/ld_1",
  // D-H17 left `/hazmat`, `/hazmat/loads` and `/hazmat/loads/new` as REDIRECTS rather than deleting
  // them: they live in notification links and bookmarks. They still have to resolve.
  "/hazmat", "/hazmat/calculator",
  "/hazmat/loads", "/hazmat/loads/new", "/hazmat/loads/hz_1",
  "/hazmat/review", "/hazmat/settings/equipment",
  "/vehicles", "/vehicles/v_1",
  "/odometer", "/coverage", "/recall-audit", "/trailers", "/reefer-coverage",
  "/fuel-planning", "/truck-stops", "/idling",
  "/drivers", "/drivers/dr_1",
  "/compliance", "/compliance/dr_1",
  // R7 added `/recruitment/:id`, which makes these three another specificity pair: the two static
  // segments must keep beating the param, or the inquiry queue starts rendering an applicant record
  // for a driver whose id is the word "inquiries".
  "/recruitment", "/recruitment/screening", "/recruitment/inquiries", "/recruitment/ap_1",
  "/driver-performance", "/fuel-log", "/fuel-spend", "/fuel-spend/exceptions", "/ifta",
  // G7 deleted /accounting, /cost-schedule and /books-check and renamed /cpm; the old address
  // stays as a redirect, so it is probed here too.
  "/fleet-report", "/cpm", "/billing", "/shop",
  // The §396.17 register and one report (A7). Written out as a pair for the same reason the
  // loads routes are: a static segment must keep beating a param.
  "/shop/inspections", "/shop/inspections/insp_1", "/shop/inspectors",
  "/fuel-reconciliation", "/fuel-exceptions", "/import",
  "/transactions", "/rejections",
  "/fuel-cards", "/fuel-cards/fc_1",
  "/settings/card-control",
  "/anomalies", "/fuel-events", "/ask", "/reports",
  "/settings", "/settings/users", "/settings/permissions", "/settings/thresholds", "/settings/driver-performance",
  "/messages", "/settings/driver-app", "/settings/fuel-planning", "/settings/data",
  "/settings/efs-soap", "/settings/org", "/settings/notifications", "/settings/audit",
  // G1's operator-visited dead ends. The catch-all is deliberately NOT probed here — an unmatched
  // URL is the one case this file cannot express as "declared path resolves to itself", and it has
  // its own suite in `notFound.test.ts`.
  "/error", "/maintenance",
] as const;

describe("the route table survives being split by area", () => {
  it("route table", () => {
    const table = router
      .getRoutes()
      .map((r) => ({
        path: r.path,
        name: String(r.name ?? ""),
        // Sorted so a key-order change in a route record is not reported as a behaviour change.
        meta: Object.fromEntries(Object.entries(r.meta).sort(([a], [b]) => a.localeCompare(b))),
        redirect: typeof r.redirect === "function" ? "fn" : (r.redirect ?? null),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
    expect(table).toMatchSnapshot();
  });

  it("resolution", () => {
    const resolved = PROBES.map((p) => {
      const r = router.resolve(p);
      return { url: p, name: String(r.name ?? ""), params: r.params };
    });
    expect(resolved).toMatchSnapshot();
  });

  it("every probe matches a real route, so the snapshot cannot pass by resolving nothing", () => {
    for (const p of PROBES) expect(router.resolve(p).matched.length, p).toBeGreaterThan(0);
  });

  /**
   * D-H17 deleted the hub, the hazmat loads board and its create form, and left REDIRECTS behind
   * because those paths are in notification links and bookmarks. The snapshot above only records
   * that a redirect RECORD matched — it cannot say where the redirect goes, which is the entire
   * promise. Two of these carry a second guarantee worth stating out loud:
   *
   *  · `/hazmat/loads/new` must NOT resolve as the workspace with `id: "new"`. vue-router ranks a
   *    static segment above a dynamic one, so it does not — but that is a ranking rule, and this is
   *    the assertion that survives someone reordering the file.
   *  · `/hazmat/loads/:id` is the workspace and must keep resolving, because it is where the hazmat
   *    notification (`notificationRoute.ts`) sends the person who was told to look at a load.
   */
  it("the deleted hazmat surfaces redirect to the one loads page, not into the void (D-H17)", () => {
    const target = (path: string): string => {
      const record = router.getRoutes().find((r) => r.path === path);
      return typeof record?.redirect === "string" ? record.redirect : String(record?.redirect ?? "");
    };
    expect(target("/hazmat")).toBe("/hazmat/calculator");
    expect(target("/hazmat/loads")).toBe("/loads");
    expect(target("/hazmat/loads/new")).toBe("/loads");
    expect(target("/hazmat/settings/equipment")).toBe("/trailers");

    // The create path is a redirect in its own right, never the workspace holding id="new".
    expect(router.resolve("/hazmat/loads/new").name ?? "").not.toBe("hazmat-load-detail");
    // …while a real record id still reaches the workspace.
    const workspace = router.resolve("/hazmat/loads/hz_1");
    expect(workspace.name).toBe("hazmat-load-detail");
    expect(workspace.params).toEqual({ id: "hz_1" });
  });

  /**
   * FUEL-C2 folded Transactions and Rejections into the Fuel Log, and C4 retired `/import`. The snapshot above records only
   * that a redirect RECORD matched — it cannot say where the redirect goes, and here that is the
   * entire promise: these two paths carry filters (`/transactions?unit=654` is a real link in real
   * tickets), so a redirect that lost the query, or landed on the wrong tab, would send somebody to a
   * different set of rows than the one they were sent.
   *
   * The function is called directly rather than pushed, because pushing would run the section guard
   * and this file deliberately has no session.
   */
  it("the absorbed fuel pages redirect to their tab, carrying the filters they were sent with", () => {
    const target = (path: string, query: Record<string, string> = {}) => {
      const record = router.getRoutes().find((r) => r.path === path);
      const redirect = record?.redirect;
      if (typeof redirect !== "function") return redirect ?? null;
      // `from` is the second argument vue-router passes and neither redirect reads it; START_LOCATION
      // is the honest stand-in for "nowhere yet", which is where a forwarded link starts.
      return redirect(router.resolve({ path, query }), START_LOCATION);
    };
    expect(target("/transactions")).toEqual({ path: "/fuel-log", query: { tab: "source" } });
    expect(target("/rejections")).toEqual({ path: "/fuel-log", query: { tab: "declines" } });
    // C4's is a plain string, and that is the difference worth recording: `/import` was a FORM, so
    // it carried no filters to translate and there is no tab to land its reader on.
    expect(target("/import")).toBe("/fuel-log");
    // The filters a forwarded link carries survive the move, which is why the redirect is a function.
    expect(target("/transactions", { unit: "654", from: "2026-08-01" })).toEqual({
      path: "/fuel-log",
      query: { unit: "654", from: "2026-08-01", tab: "source" },
    });
  });

  /**
   * `public: true` is the one meta flag that admits the whole internet, and the snapshot above
   * records it only as one line in a 70-route dump — a diff a reviewer updates without reading.
   * This names the set instead, so ADDING a public route is a deliberate edit to a list with a
   * reason beside each member rather than a snapshot refresh.
   *
   * `/accept-invite` joined on 2026-09-02. It was `requiresAuth: true`, which meant the guard turned
   * every failed invite link — spent by a mail scanner, expired, or merely not yet redeemed — into a
   * redirect to /login, so nobody could tell a broken link from a wrong password. Since 2026-09-04
   * the page holds the invitation's own token and redeems it through the public
   * `/api/public/invites` surface, which creates the login and the membership; the page then signs in.
   */
  it("names every route reachable without a session", () => {
    const publicPaths = router
      .getRoutes()
      .filter((r) => r.meta.public === true && r.path !== "/__design-system")
      .map((r) => r.path)
      .sort();
    expect(publicPaths).toEqual([
      // G1's catch-all and its two dead-end pages. Public by necessity: a 404 or an outage screen
      // that bounces you to /login first tells you nothing about why you are not where you meant to be.
      "/:pathMatch(.*)*",
      "/accept-invite", // redeems the invitation's own token via /api/public/invites; membership written server-side
      "/apply/:token", // H5b — the applicant's form; the token IS the access control
      "/error",
      "/login",
      "/maintenance",
      "/placard-calculator", // M7 — the free public calculator, deliberately indexable
    ]);
  });

  it("every declared path is probed, so a new route cannot slip in unpinned", () => {
    // Params are stripped from both sides: `/drivers/:id` is covered by the probe `/drivers/dr_1`.
    const shape = (p: string) => p.replace(/:[^/]+/g, "*");
    const declared = new Set(router.getRoutes().map((r) => shape(r.path)));
    declared.delete("/__design-system"); // dev-only, asserted by its absence from PROBES
    declared.delete("/*"); // the G1 catch-all — covered by `notFound.test.ts`, not probeable here
    const probed = new Set(
      PROBES.map((p) => {
        const r = router.resolve(p);
        return shape(r.matched[r.matched.length - 1]!.path);
      }),
    );
    expect([...declared].filter((d) => !probed.has(d))).toEqual([]);
  });
});
