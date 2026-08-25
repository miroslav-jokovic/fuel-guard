import { describe, it, expect } from "vitest";
import { router } from "./index";

/**
 * Every `meta.parent` points at a route that actually exists (G2, UI-GAPS-PLAN.md).
 *
 * This is the test the breadcrumb feature is worth. `meta.parent` is a hand-written path string, so
 * nothing but this connects it to the route table: rename `/settings/audit`'s parent, or delete a
 * section route, and fifteen breadcrumbs quietly point at a page that is not there. The back chevron
 * has had the same exposure since it shipped and nothing has been checking it either.
 *
 * ⚠ `.matched.length > 0` is NOT a valid check here, and was the obvious wrong way to write this.
 * Since G1 the router has a catch-all, so `router.resolve("/anything-at-all")` matches the not-found
 * record and reports one match. The assertion has to be that the resolved route is not `not-found`.
 */
describe("every meta.parent resolves to a real route (G2)", () => {
  const withParent = router
    .getRoutes()
    .filter((r) => typeof r.meta?.parent === "string")
    .map((r) => ({ path: r.path, parent: r.meta.parent as string }));

  it("there are parents to check, so this cannot pass by finding none", () => {
    expect(withParent.length).toBeGreaterThanOrEqual(20);
  });

  it("no parent path falls through to the catch-all", () => {
    const dead = withParent.filter((r) => router.resolve(r.parent).name === "not-found");
    expect(dead).toEqual([]);
  });

  it("every parent carries a title, because a crumb with no label cannot render", () => {
    const untitled = withParent.filter(
      (r) => typeof router.resolve(r.parent).meta.title !== "string",
    );
    expect(untitled).toEqual([]);
  });

  it("no parent chain contains a cycle", () => {
    for (const { path } of withParent) {
      const seen = new Set<string>();
      let cur: string | undefined = path;
      let steps = 0;
      while (cur && steps++ < 10) {
        if (seen.has(cur)) break;
        seen.add(cur);
        const parent: unknown = router.resolve(cur).meta.parent;
        cur = typeof parent === "string" ? parent : undefined;
      }
      expect(steps, `${path} walks a cycle or an over-deep chain`).toBeLessThan(10);
    }
  });
});
