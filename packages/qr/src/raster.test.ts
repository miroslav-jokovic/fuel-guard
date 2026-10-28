import { describe, expect, it } from "vitest";
import { createBitmap, drawQr, fillPolygons, fillRect } from "./raster.js";
import { encode, QUIET_ZONE_MODULES } from "./encode.js";

/**
 * The printed label is a picture (D-PS2), so what is pinned is that the picture is the symbol: every
 * module a whole number of dots, every module read back equal to the matrix, the quiet zone clear,
 * and a glyph's counter left open.
 */

const at = (b: ReturnType<typeof createBitmap>, x: number, y: number) => b.dark[y * b.width + x];

describe("drawQr", () => {
  const matrix = encode("SIL1:AST:7K3M9P");

  it("reads back module for module, at a whole number of dots per module", () => {
    const b = createBitmap(406, 406);
    const size = 300;
    const module = drawQr(b, matrix, 50, 20, size);
    const cells = matrix.size + QUIET_ZONE_MODULES * 2;
    expect(module).toBe(Math.floor(size / cells));
    const drawn = module * cells;
    const left = Math.round(50 + (size - drawn) / 2) + QUIET_ZONE_MODULES * module;
    const top = Math.round(20 + (size - drawn) / 2) + QUIET_ZONE_MODULES * module;
    for (let r = 0; r < matrix.size; r += 1) {
      for (let c = 0; c < matrix.size; c += 1) {
        // Every dot of the module agrees with the matrix — no module bleeds a dot into its neighbour.
        for (const [dx, dy] of [[0, 0], [module - 1, 0], [0, module - 1], [module - 1, module - 1]] as const) {
          expect(at(b, left + c * module + dx, top + r * module + dy)).toBe(matrix.modules[r]![c] ? 1 : 0);
        }
      }
    }
  });

  it("leaves the quiet zone clear", () => {
    const b = createBitmap(406, 406);
    const module = drawQr(b, matrix, 0, 0, 406);
    const cells = matrix.size + QUIET_ZONE_MODULES * 2;
    const offset = Math.round((406 - module * cells) / 2);
    const quiet = offset + QUIET_ZONE_MODULES * module;
    for (let y = 0; y < 406; y += 1) {
      for (let x = 0; x < quiet; x += 1) expect(at(b, x, y)).toBe(0);
    }
  });

  it("refuses a square too small for one dot per module, rather than drawing an unreadable smear", () => {
    expect(() => drawQr(createBitmap(20, 20), matrix, 0, 0, 20)).toThrow(/needs at least/);
  });
});

describe("fillPolygons", () => {
  it("fills a square exactly, by dot centres", () => {
    const b = createBitmap(10, 10);
    fillPolygons(b, [[[2, 2], [6, 2], [6, 6], [2, 6]]]);
    let n = 0;
    for (let i = 0; i < b.dark.length; i += 1) n += b.dark[i]!;
    expect(n).toBe(16);
    expect(at(b, 2, 2)).toBe(1);
    expect(at(b, 6, 6)).toBe(0);
  });

  it("leaves a counter open when it winds the other way, as a glyph's does", () => {
    const b = createBitmap(12, 12);
    const outer = [[1, 1], [11, 1], [11, 11], [1, 11]] as const;
    const inner = [[4, 4], [4, 8], [8, 8], [8, 4]] as const;
    fillPolygons(b, [outer, inner]);
    expect(at(b, 2, 2)).toBe(1);
    expect(at(b, 5, 5)).toBe(0);
  });

  it("fills overlapping strokes that wind the same way (non-zero, not even-odd)", () => {
    const b = createBitmap(12, 12);
    fillPolygons(b, [[[1, 1], [8, 1], [8, 8], [1, 8]], [[4, 4], [11, 4], [11, 11], [4, 11]]]);
    expect(at(b, 5, 5)).toBe(1);
  });
});

describe("fillRect", () => {
  it("clips to the bitmap rather than writing past it", () => {
    const b = createBitmap(4, 4);
    fillRect(b, -2, -2, 10, 3);
    expect(Array.from(b.dark.slice(0, 4))).toEqual([1, 1, 1, 1]);
    expect(at(b, 0, 1)).toBe(0);
  });
});
