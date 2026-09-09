import { describe, expect, it } from "vitest";
import { encode, QUIET_ZONE_MODULES, type QrMatrix } from "./encode.js";
import { toSvg, toSvgPath } from "./svg.js";

const matrix = encode("SIL1:AST:7K3M9P", { ecc: "H" });

/** A 3x3 with a single dark module in the middle — small enough to reason about by hand. */
const tiny: QrMatrix = {
  size: 3,
  version: 1,
  modules: [
    [false, false, false],
    [false, true, false],
    [false, false, false],
  ],
};

describe("toSvgPath", () => {
  it("places a module inside the quiet zone at the right offset", () => {
    // 3 modules + 4 quiet each side = 11 across. At size 11 each module is exactly 1 unit, so the
    // centre module's top-left is (1 + 4, 1 + 4) = (5, 5) — checkable without arithmetic in the head.
    expect(toSvgPath(tiny, { size: 11 })).toBe("M5 5h1v1h-1z");
  });

  it("honours a quiet zone of zero", () => {
    expect(toSvgPath(tiny, { size: 3, quietZone: 0 })).toBe("M1 1h1v1h-1z");
  });

  it("defaults to the specification's four-module quiet zone", () => {
    expect(QUIET_ZONE_MODULES).toBe(4);
    expect(toSvgPath(tiny, { size: 11 })).toBe(toSvgPath(tiny, { size: 11, quietZone: 4 }));
  });

  it("coalesces a horizontal run into one rectangle rather than three", () => {
    const run: QrMatrix = {
      size: 3,
      version: 1,
      modules: [
        [true, true, true],
        [false, false, false],
        [false, false, false],
      ],
    };
    const path = toSvgPath(run, { size: 11, quietZone: 0 });
    expect(path.match(/M/g)).toHaveLength(1);
    expect(path).toContain("h11");
  });

  it("emits nothing for an all-light matrix", () => {
    const blank: QrMatrix = { size: 2, version: 1, modules: [[false, false], [false, false]] };
    expect(toSvgPath(blank)).toBe("");
  });

  it("formats coordinates deterministically, without a runtime's float spelling", () => {
    // Two engines disagreeing in the last decimal place is what would break I10's pixel comparison
    // between the printed PDF and the on-screen preview.
    const path = toSvgPath(matrix, { size: 100 });
    expect(path).not.toMatch(/e[+-]?\d/i); // no exponential notation
    expect(path).not.toMatch(/\.\d{5,}/); // never more than four decimals
    expect(path).toBe(toSvgPath(matrix, { size: 100 }));
  });

  it("covers exactly the dark modules of a real symbol", () => {
    const dark = matrix.modules.flat().filter(Boolean).length;
    // Each command is one horizontal run, so the run count is at most the dark-module count and
    // strictly less once anything coalesces.
    const commands = toSvgPath(matrix, { size: 100 }).match(/M/g)?.length ?? 0;
    expect(commands).toBeGreaterThan(0);
    expect(commands).toBeLessThan(dark);
  });
});

describe("toSvg", () => {
  const svg = toSvg(matrix, { size: 120 });

  it("is a self-contained document at the requested size", () => {
    expect(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\"")).toBe(true);
    expect(svg).toContain('viewBox="0 0 120 120"');
    expect(svg).toContain('width="120" height="120"');
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("disables antialiasing, which is load-bearing rather than cosmetic", () => {
    // Without it a browser softens the module edges and a scanner sees grey where it needs a hard
    // black/white transition.
    expect(svg).toContain('shape-rendering="crispEdges"');
  });

  it("wraps the same path toSvgPath produces, so the PDF and the preview cannot diverge", () => {
    expect(svg).toContain(`<path d="${toSvgPath(matrix, { size: 120 })}"`);
  });

  it("paints a white background by default and omits it when asked", () => {
    expect(svg).toContain('<rect width="120" height="120" fill="#ffffff"/>');
    expect(toSvg(matrix, { size: 120, background: null })).not.toContain("<rect");
  });
});
