import { describe, expect, it } from "vitest";
import { textLayerOf, wordsOfRun, type PageGeometry, type TextRun } from "./textLayer.js";

/**
 * The pure word-boxing rule, with hand-computed geometry: a 100 × 200 pt page rendered at scale 1,
 * so the viewport flips y (`[1, 0, 0, -1, 0, 200]`) and a fraction is points / 100 or / 200.
 */
const PAGE: PageGeometry = { transform: [1, 0, 0, -1, 0, 200], width: 100, height: 200 };
/** A 10-pt run whose baseline starts at (10, 150) in PDF space — 50 pt from the top. */
const run = (str: string, width: number, glyphWidth?: TextRun["glyphWidth"]): TextRun => ({
  str,
  transform: [10, 0, 0, 10, 10, 150],
  width,
  ascent: 0.8,
  descent: -0.2,
  glyphWidth,
});

describe("wordsOfRun", () => {
  it("boxes a one-word run from ascent to descent at its baseline", () => {
    expect(wordsOfRun(run("AB", 20), PAGE)).toEqual([{ text: "AB", bbox: { x: 0.1, y: 0.21, w: 0.2, h: 0.05 } }]);
  });

  it("weighs inner words by the font's glyph widths: a wide W and a narrow i split 3:1", () => {
    const widths: Record<string, number> = { W: 900, i: 300, " ": 300 };
    // "W i" = 900 + 300 + 300 = 1500 units over 30 pt → W ends at 18 pt, "i" starts at 24 pt.
    const [w, i] = wordsOfRun(run("W i", 30, (c) => widths[c]), PAGE);
    expect(w!.bbox.x * 100).toBeCloseTo(10, 6);
    expect(w!.bbox.w * 100).toBeCloseTo(18, 6);
    expect(i!.bbox.x * 100).toBeCloseTo(34, 6);
  });

  it("falls back to cutting by character count when the font's widths are unknown", () => {
    const [, second] = wordsOfRun(run("AB CD", 50), PAGE);
    expect(second!.bbox.x * 100).toBeCloseTo(40, 6);
  });

  it("clamps a run that overhangs the page to the 0..1 fractions bboxSchema allows", () => {
    const [word] = wordsOfRun(run("WIDE", 500), PAGE);
    expect(word!.bbox.x + word!.bbox.w).toBe(1);
  });
});

describe("textLayerOf", () => {
  it("is null for a page with no words — whitespace-only runs are not a text layer", () => {
    expect(textLayerOf([run("   ", 10), run("", 0)], PAGE)).toBeNull();
    expect(textLayerOf([], PAGE)).toBeNull();
  });
});
