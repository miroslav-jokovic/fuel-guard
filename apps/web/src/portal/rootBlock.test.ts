import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { portalTokens, rootBlock } from "./rootBlock";

/**
 * The driver page takes its colours from the design system's token file without importing it whole
 * (that pulled Tailwind in: 115 KB). `portalTokens` is the cut; a renamed or restructured token file must
 * fail the build, not ship a page with no colours.
 */
describe("the colour tokens the driver page takes", () => {
  it("is the first top-level :root block, nested braces included, and nothing after it", () => {
    const css = ":root {\n  --a: 1;\n  @supports (x: y) { --b: 2; }\n}\n.dark { --a: 0; }\n:root { --c: 3; }";
    expect(rootBlock(css)).toBe(":root {\n  --a: 1;\n  @supports (x: y) { --b: 2; }\n}");
  });
  it("refuses a file with no :root block, or one never closed", () => {
    expect(() => rootBlock(".x { --a: 1; }")).toThrow(/no top-level :root/);
    expect(() => rootBlock(":root { --a: 1;")).toThrow(/unterminated/);
  });
  it("gives the page every colour its stylesheet reads, from the real token file", () => {
    const file = path.resolve(__dirname, "../../../../packages/ui/src/tokens.generated.css");
    const tokens = portalTokens(fs.readFileSync(file, "utf8"));
    const defined = new Set([...tokens.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]!));
    const page = fs.readFileSync(path.resolve(__dirname, "portal.css"), "utf8");
    const used = new Set([...page.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!));
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) expect(defined.has(name), `${name} is read by portal.css but not defined`).toBe(true);
    // …and what those names point at is defined too: an alias to a missing value is still no colour.
    for (const [, ref] of tokens.matchAll(/var\((--[\w-]+)/g)) expect(defined.has(ref!), `${ref} is referenced but not defined`).toBe(true);
  });
  it("refuses a token file whose theme declares no colours", () => {
    expect(() => portalTokens(":root { --a: 1; }\n@theme inline { --font-sans: x; }")).toThrow(/no --color-/);
  });
});
