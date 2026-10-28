import { describe, expect, it } from "vitest";
import { encode, QUIET_ZONE_MODULES } from "@silvicom/qr";
import type { LabelFaceDto } from "@silvicom/shared";
import { isRollStock, renderLabelBitmap } from "./labelRaster.js";

/**
 * The label the MUNBYN prints is drawn here (D-PS2). Pinned: the size of the stock in dots, a symbol
 * that reads back module for module where the PDF puts it (top, centred), text under it, the nudge
 * moving everything, and a sheet stock refused rather than guessed at.
 */

const FACE: LabelFaceDto = {
  target: { kind: "asset", assetId: "33333333-3333-4333-8333-333333333333" },
  payload: "SIL1:AST:7K3M9P",
  code: "7K3M9P",
  lines: ["A-0412 · Cab tablet"],
};
const OPTS = { presetId: "roll-single" as const, dpi: 203, offsetX: 0, offsetY: 0 };

const darkIn = (b: ReturnType<typeof renderLabelBitmap>, x0: number, y0: number, x1: number, y1: number) => {
  let n = 0;
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) n += b.dark[y * b.width + x]!;
  return n;
};

/** Find the symbol's finder pattern: the first dark dot from the top-left, scanning rows. */
function firstDark(b: ReturnType<typeof renderLabelBitmap>): { x: number; y: number } {
  for (let y = 0; y < b.height; y += 1) for (let x = 0; x < b.width; x += 1) if (b.dark[y * b.width + x]) return { x, y };
  throw new Error("blank label");
}

describe("renderLabelBitmap", () => {
  it("is the 2-inch stock, in dots, at 203 dpi", () => {
    const b = renderLabelBitmap(FACE, OPTS);
    expect([b.width, b.height]).toEqual([406, 406]);
  });

  it("draws the symbol module for module, at a whole number of dots per module", () => {
    const b = renderLabelBitmap(FACE, OPTS);
    const matrix = encode(FACE.payload);
    const origin = firstDark(b); // the top-left finder's corner is the first dark module
    // The finder's top row is 7 dark modules; measure its width to learn the module pitch.
    let run = 0;
    while (b.dark[origin.y * b.width + origin.x + run]) run += 1;
    const module = run / 7;
    expect(Number.isInteger(module) && module >= 2).toBe(true);
    for (let r = 0; r < matrix.size; r += 1) {
      for (let c = 0; c < matrix.size; c += 1) {
        const x = origin.x + c * module + Math.floor(module / 2);
        const y = origin.y + r * module + Math.floor(module / 2);
        expect(b.dark[y * b.width + x], `module ${r},${c}`).toBe(matrix.modules[r]![c] ? 1 : 0);
      }
    }
    // Centred left to right, as the PDF does.
    const right = origin.x + matrix.size * module;
    expect(Math.abs(origin.x - (406 - right))).toBeLessThanOrEqual(2);
    // The quiet zone above the symbol is inside the label: four modules of white at least.
    expect(origin.y).toBeGreaterThanOrEqual(QUIET_ZONE_MODULES * module);
  });

  it("writes the code and the line under the symbol", () => {
    const b = renderLabelBitmap(FACE, OPTS);
    const blank = renderLabelBitmap({ ...FACE, code: " ", lines: [] }, OPTS);
    // The bottom fifth is text on one and empty on the other.
    expect(darkIn(b, 0, 330, 406, 406)).toBeGreaterThan(500);
    expect(darkIn(blank, 0, 330, 406, 406)).toBe(0);
  });

  it("moves everything by the printer's nudge", () => {
    const plain = firstDark(renderLabelBitmap(FACE, OPTS));
    const nudged = firstDark(renderLabelBitmap(FACE, { ...OPTS, offsetX: 10, offsetY: -5 }));
    expect([nudged.x - plain.x, nudged.y - plain.y]).toEqual([10, -5]);
  });

  it("draws a character the face lacks as '?' instead of nothing", () => {
    const missing = renderLabelBitmap({ ...FACE, lines: ["\u4e2d"] }, OPTS);
    const question = renderLabelBitmap({ ...FACE, lines: ["?"] }, OPTS);
    expect(Buffer.from(missing.dark).equals(Buffer.from(question.dark))).toBe(true);
  });

  it("refuses a sheet stock — a label printer feeds one label at a time", () => {
    expect(isRollStock("avery-22805")).toBe(false);
    expect(isRollStock("roll-single")).toBe(true);
    expect(() => renderLabelBitmap(FACE, { ...OPTS, presetId: "avery-22805" })).toThrow(/sheet for an office printer/);
  });
});
