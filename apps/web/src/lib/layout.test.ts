import { describe, it, expect } from "vitest";
import { resolveLayout } from "./layout";

describe("resolveLayout (G1)", () => {
  it("signed out, a dead-end page swaps AppShell for the centered auth shell", () => {
    const meta = { public: true, layoutWhenSignedOut: "auth", title: "Page not found" };
    expect(resolveLayout(meta, false)).toBe("auth");
  });

  it("signed in, the same page keeps the normal shell so the sidebar is there to escape with", () => {
    const meta = { public: true, layoutWhenSignedOut: "auth", title: "Page not found" };
    expect(resolveLayout(meta, true)).toBeUndefined();
  });

  it("a route without the override is untouched in both states", () => {
    expect(resolveLayout({ layout: "auth" }, false)).toBe("auth");
    expect(resolveLayout({ layout: "auth" }, true)).toBe("auth");
    expect(resolveLayout({ requiresAuth: true, title: "Dashboard" }, true)).toBeUndefined();
    expect(resolveLayout({ layout: "apply" }, false)).toBe("apply");
    expect(resolveLayout({ layout: "public" }, false)).toBe("public");
    expect(resolveLayout({ layout: "lab" }, false)).toBe("lab");
  });

  it("the override never fires for a signed-in user, even if a route sets both", () => {
    expect(resolveLayout({ layout: "public", layoutWhenSignedOut: "auth" }, true)).toBe("public");
    expect(resolveLayout({ layout: "public", layoutWhenSignedOut: "auth" }, false)).toBe("auth");
  });
});
