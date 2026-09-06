import { describe, it, expect } from "vitest";
import { resolveAlpha } from "./chartTheme";

// resolveAlpha must produce a genuinely translucent rgba() so gradient/wash fills fade — regardless of
// how the browser serialized the base color. If it ever returns the opaque color, area fills go solid.
describe("resolveAlpha", () => {
  it("returns a translucent rgba() carrying the requested alpha (jsdom hex fallback path)", () => {
    const out = resolveAlpha("--viz-spend", 0.3);
    expect(out).toMatch(/^rgba\(\d+, \d+, \d+, 0\.3\)$/);
  });

  it("distinct alphas yield distinct strings (a gradient needs different stops)", () => {
    const a = resolveAlpha("--viz-brand", 0.3);
    const b = resolveAlpha("--viz-brand", 0);
    expect(a).not.toBe(b);
    expect(a).toContain("0.3");
    expect(b).not.toContain("0.3");
  });
});
