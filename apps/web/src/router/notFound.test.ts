import { describe, it, expect } from "vitest";
import { router } from "./index";

/**
 * G1 (UI-GAPS-PLAN.md) — the router now matches something for every URL.
 *
 * Before this, no catch-all existed. `App.vue` picks `AppShell` for any route without
 * `meta.layout`; an unmatched path has no matched record, so `meta.layout` was undefined, and the
 * result was the full sidebar, header and notification bell wrapped around an empty `<main>`. A
 * typo, a link that rotted in somebody's email, and a route dropped by a bad deploy all rendered
 * identically, and all three looked like the application was broken.
 */
describe("the catch-all route (G1)", () => {
  it("an unknown path resolves to the not-found page", () => {
    expect(router.resolve("/nope").name).toBe("not-found");
    expect(router.resolve("/nope/nope/nope").name).toBe("not-found");
    expect(router.resolve("/settings/there-is-no-such-setting").name).toBe("not-found");
  });

  it("it is public, so a signed-out visitor is told what happened instead of being bounced to login", () => {
    const meta = router.resolve("/nope").meta;
    expect(meta.public).toBe(true);
    expect(meta.requiresAuth).toBeUndefined();
  });

  it("it renders in the auth shell when signed out, because AppShell fetches modules unconditionally", () => {
    // The AppShell/AuthLayout switch itself lives in App.vue and is asserted in lib/layout.test.ts; this
    // pins the meta key that drives it, which is the half that lives in the route table.
    expect(router.resolve("/nope").meta.layoutWhenSignedOut).toBe("auth");
    expect(router.resolve("/error").meta.layoutWhenSignedOut).toBe("auth");
    expect(router.resolve("/maintenance").meta.layoutWhenSignedOut).toBe("auth");
  });

  it("no declared route falls through to it — the catch-all is genuinely last", () => {
    const declared = router
      .getRoutes()
      .filter((r) => r.name !== "not-found" && !r.path.includes(":"))
      .map((r) => r.path);
    // Every static path in the product still resolves to itself. A catch-all placed too early, or
    // a route lost in the area split, shows up here rather than in production.
    expect(declared.length).toBeGreaterThan(50);
    for (const p of declared) {
      expect(router.resolve(p).name, p).not.toBe("not-found");
    }
  });

  it("the two operator-visited dead ends are reachable and public", () => {
    const pages: [string, string][] = [
      ["/error", "server-error"],
      ["/maintenance", "maintenance"],
    ];
    for (const [path, name] of pages) {
      expect(router.resolve(path).name).toBe(name);
      expect(router.resolve(path).meta.public).toBe(true);
    }
  });
});
