import { describe, it, expect } from "vitest";
import { buildTrail, type CrumbMeta } from "./breadcrumbs";

/** The real chain from the router, written out so the test does not depend on the route table. */
const ROUTES: Record<string, CrumbMeta> = {
  "/hazmat": { title: "HazmatGuard" },
  "/hazmat/loads": { title: "Hazmat Loads", parent: "/hazmat" },
  "/hazmat/loads/hz_1": { title: "Hazmat Load", parent: "/hazmat/loads" },
  "/settings": { title: "Settings" },
  "/settings/audit": { title: "Audit Log", parent: "/settings" },
  "/": { title: "Dashboard" },
  "/untitled": { parent: "/settings" },
};
const resolve = (p: string): CrumbMeta | null => ROUTES[p] ?? null;

describe("buildTrail (G2)", () => {
  it("walks the real three-level chain, root first, current page last", () => {
    expect(buildTrail("/hazmat/loads/hz_1", resolve)).toEqual([
      { label: "HazmatGuard", to: "/hazmat" },
      { label: "Hazmat Loads", to: "/hazmat/loads" },
      { label: "Hazmat Load", to: "/hazmat/loads/hz_1" },
    ]);
  });

  it("a two-level chain is the common case — 15 settings children look like this", () => {
    expect(buildTrail("/settings/audit", resolve)).toEqual([
      { label: "Settings", to: "/settings" },
      { label: "Audit Log", to: "/settings/audit" },
    ]);
  });

  it("a top-level route yields one crumb, which the caller declines to render", () => {
    expect(buildTrail("/", resolve)).toEqual([{ label: "Dashboard", to: "/" }]);
  });

  it("an unknown path yields nothing rather than throwing", () => {
    expect(buildTrail("/no-such-page", resolve)).toEqual([]);
  });

  it("a parent pointing at a route that no longer exists truncates instead of throwing", () => {
    const withDeadParent = (p: string): CrumbMeta | null =>
      p === "/orphan" ? { title: "Orphan", parent: "/deleted-last-release" } : resolve(p);
    // The child is still useful on its own; the trail simply stops where the graph does.
    expect(buildTrail("/orphan", withDeadParent)).toEqual([{ label: "Orphan", to: "/orphan" }]);
  });

  it("a cycle terminates instead of hanging the render", () => {
    const cyclic: Record<string, CrumbMeta> = {
      "/a": { title: "A", parent: "/b" },
      "/b": { title: "B", parent: "/a" },
    };
    const trail = buildTrail("/a", (p) => cyclic[p] ?? null);
    // Stops the moment it revisits a path, and keeps what it had — the assertion that matters is
    // that this returns at all.
    expect(trail).toEqual([
      { label: "B", to: "/b" },
      { label: "A", to: "/a" },
    ]);
  });

  it("a chain longer than the cap degrades to a truncated trail, not a hung one", () => {
    // Seven levels, each parented to the one above: /d0 <- /d1 <- ... <- /d6.
    const deep = (p: string): CrumbMeta | null => {
      const n = Number(p.slice(2));
      if (Number.isNaN(n)) return null;
      return { title: `L${n}`, parent: n > 0 ? `/d${n - 1}` : undefined };
    };
    const trail = buildTrail("/d6", deep);
    expect(trail).toHaveLength(5);
    // Kept the five NEAREST the current page, since those are the ones a reader needs.
    expect(trail.map((c) => c.label)).toEqual(["L2", "L3", "L4", "L5", "L6"]);
  });

  it("a route with no title stops the walk rather than inventing a label from the path", () => {
    expect(buildTrail("/untitled", resolve)).toEqual([]);
  });
});
