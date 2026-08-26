import { describe, it, expect } from "vitest";
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
  "/hazmat", "/hazmat/calculator",
  "/hazmat/loads", "/hazmat/loads/new", "/hazmat/loads/hz_1",
  "/hazmat/review", "/hazmat/settings/equipment",
  "/vehicles", "/vehicles/v_1",
  "/odometer", "/coverage", "/recall-audit", "/trailers", "/reefer-coverage",
  "/fuel-planning", "/truck-stops", "/idling",
  "/drivers", "/drivers/dr_1",
  "/compliance", "/compliance/dr_1",
  "/recruitment", "/recruitment/screening", "/recruitment/inquiries",
  "/driver-performance", "/fuel-log", "/fuel-spend", "/fuel-spend/exceptions",
  "/fuel-reconciliation", "/fuel-exceptions", "/import",
  "/transactions", "/rejections",
  "/fuel-cards", "/fuel-cards/fc_1",
  "/settings/card-control",
  "/anomalies", "/fuel-events", "/ask", "/reports",
  "/settings", "/settings/users", "/settings/thresholds", "/settings/driver-performance",
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
