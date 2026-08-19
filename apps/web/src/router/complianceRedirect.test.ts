import { describe, it, expect } from "vitest";
import type { RouteLocationRaw, RouteLocation } from "vue-router";
import { router } from "./index";

/**
 * D2 — the redirect that lets D1 restructure without breaking anything: every /compliance/:id
 * reference in the product (fleet table links, notification deep links, bookmarks, binder
 * references) lands on the driver detail page with the qualification section selected. Asserted on
 * the route record itself — resolve() reports the matched record, and a full push would drag the
 * auth guard and the page chunk into a unit test.
 */
describe("/compliance/:id redirect (D2)", () => {
  it("redirects to driver-detail with the qualification section", () => {
    const rec = router.getRoutes().find((r) => r.name === "driver-qualification");
    expect(rec).toBeDefined();
    const redirect = rec!.redirect as (to: Pick<RouteLocation, "params">) => RouteLocationRaw;
    expect(typeof redirect).toBe("function");
    expect(redirect({ params: { id: "d1" } })).toEqual({
      name: "driver-detail",
      params: { id: "d1" },
      query: { section: "qualification" },
    });
  });

  it("the list page /compliance itself is untouched", () => {
    expect(router.resolve("/compliance").name).toBe("compliance");
  });
});
