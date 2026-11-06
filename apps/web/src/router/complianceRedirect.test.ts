import { describe, it, expect } from "vitest";
import type { RouteLocationRaw, RouteLocation } from "vue-router";
import { QUALIFICATION_ATTENTION_VIEW } from "@silvicom/shared";
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

  /**
   * DQ-INTO-DRIVERS-PLAN D-DQ16: the list folded into Drivers on 2026-11-06. Its path redirects to the
   * built-in "Qualification: needs attention" view, so a bookmark lands on the drivers it was kept for.
   */
  it("sends the retired list /compliance to Drivers, on the drivers whose file needs attention", () => {
    const rec = router.getRoutes().find((r) => r.name === "compliance");
    expect(rec?.redirect).toEqual({ name: "drivers", query: { file: "attention", sort: "file" } });
    // …which is exactly the built-in view the Drivers menu offers, so the redirect names it.
    expect(new URLSearchParams(QUALIFICATION_ATTENTION_VIEW.query).toString()).toBe("file=attention&sort=file");
    expect(rec?.components?.default).toBeUndefined();
  });
});
