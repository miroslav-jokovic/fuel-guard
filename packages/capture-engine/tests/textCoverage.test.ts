import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { smallTextBandCoverage, textCoverageFraction, unionArea, type TextBox } from "../src/textCoverage.js";

/**
 * F7: `textCoverageFraction` and `smallTextBandCoverage` measure what their names say
 * (SCANNER-UPGRADE-PLAN.md Step 3.3, D-SCAN8/D-SCAN9).
 *
 * Two halves. First the PROPERTIES — the things that must be true of any correct union, written as
 * claims rather than as numbers, because a baseline file can only ever say "it still does what it did".
 * Then the baseline itself, which is what the Swift and Kotlin ports are held to, recomputed here so
 * that a definition change without a regeneration fails in CI rather than silently retiring the
 * native suites' contract (the same failure mode `expected.test.ts` exists for).
 */

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));

interface BaselineCase {
  name: string;
  why: string;
  boxes: TextBox[];
  unionAreaPx: number;
  textCoverageFraction: number;
  smallTextBandCoverage: number;
  legacy: { sumFraction: number; smallBand: number };
}

const baseline = JSON.parse(readFileSync(join(FIXTURES, "textBoxes.json"), "utf8")) as {
  textCoverageVersion: string;
  width: number;
  height: number;
  tolerance: { fractionAbsolute: number; decimals: number };
  cases: BaselineCase[];
};

const W = baseline.width;
const H = baseline.height;

describe("unionArea — the properties any correct union has", () => {
  it("counts overlapping area once, where the summing version counted it twice", () => {
    // The defect in one assertion. Two 200x200 boxes overlapping in a 100x100 square: 80,000 px of
    // union, 90,000 px if you add the areas. Anything that answers 90000 here is the old code.
    const boxes: TextBox[] = [
      { x: 100, y: 100, width: 200, height: 200 },
      { x: 200, y: 200, width: 200, height: 200 },
    ];
    expect(unionArea(boxes, W, H)).toBe(70_000);
    expect(boxes.reduce((s, b) => s + b.width * b.height, 0)).toBe(80_000);
  });

  it("is unchanged by repeating a box, so a redundant engine cannot inflate coverage", () => {
    // Both OS engines emit boxes that nest or repeat — a word inside a line inside a paragraph. Under
    // the old sum this raised the score, which meant the LESS confident the OCR, the more legible the
    // page appeared. That inversion is the reason F7 is a defect and not a tidy-up.
    const one: TextBox[] = [{ x: 0, y: 0, width: 500, height: 500 }];
    const four = [...one, ...one, ...one, ...one];
    expect(unionArea(four, W, H)).toBe(unionArea(one, W, H));
  });

  it("never exceeds the page, however far the boxes hang off it", () => {
    const boxes: TextBox[] = [{ x: -5000, y: -5000, width: 20_000, height: 20_000 }];
    expect(unionArea(boxes, W, H)).toBe(W * H);
    expect(textCoverageFraction(boxes, W, H)).toBe(1);
  });

  it("ignores a shared edge — touching is not overlapping", () => {
    const boxes: TextBox[] = [
      { x: 100, y: 100, width: 100, height: 100 },
      { x: 200, y: 100, width: 100, height: 100 },
    ];
    // 20,000 exactly: two full boxes, with the shared edge contributing nothing because it has no
    // width. A union that merged them into a bounding box would answer the same here, which is why
    // the next case exists.
    expect(unionArea(boxes, W, H)).toBe(20_000);
  });

  it("does not fill the gap between two separated boxes", () => {
    // The bounding-box mistake, isolated. A naive "min/max of all corners" answers 250,000.
    const boxes: TextBox[] = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 400, y: 400, width: 100, height: 100 },
    ];
    expect(unionArea(boxes, W, H)).toBe(20_000);
  });

  it("contributes nothing for a degenerate or negative box", () => {
    expect(unionArea([{ x: 10, y: 10, width: 0, height: 100 }], W, H)).toBe(0);
    expect(unionArea([{ x: 10, y: 10, width: 100, height: 0 }], W, H)).toBe(0);
    expect(unionArea([{ x: 10, y: 10, width: -100, height: -100 }], W, H)).toBe(0);
  });

  it("returns 0 rather than NaN for an empty set or a zero-sized page", () => {
    expect(textCoverageFraction([], W, H)).toBe(0);
    expect(textCoverageFraction([{ x: 0, y: 0, width: 10, height: 10 }], 0, 0)).toBe(0);
    expect(smallTextBandCoverage([], W, H)).toBe(0);
  });
});

describe("smallTextBandCoverage — a coverage fraction, not a sum of heights", () => {
  it("is a fraction — bounded by 1 — where the old sum of heights was not", () => {
    // THE F7 defect, stated as the one thing that cannot be argued about. Σ(line heights)/imageHeight
    // is a sum of heights over a height: pile up enough lines and it passes 1, which a "coverage
    // fraction" cannot do and still mean anything. A dense page of fine print is not an exotic input
    // — it is what a bill of lading looks like.
    const lines: TextBox[] = Array.from({ length: 500 }, (_, i) => ({
      x: 0,
      y: (i * 7) % (H - 20),
      width: 400,
      height: 20,
    }));
    const legacy = (boxes: TextBox[]) => {
      const sorted = boxes.map((b) => b.height).sort((a, b) => a - b);
      return sorted.slice(0, Math.max(1, Math.floor(sorted.length / 4))).reduce((a, b) => a + b, 0) / H;
    };
    expect(legacy(lines)).toBeGreaterThan(1);
    const measured = smallTextBandCoverage(lines, W, H);
    expect(measured).toBeLessThanOrEqual(1);
    expect(measured).toBeGreaterThan(0);
  });

  it("counts a region once when the quartile contains the same line twice", () => {
    // The union half of the fix, isolated from the selection half. Eight lines, each reported twice
    // as a line box and a word box would be: the quartile is four boxes covering two DISTINCT
    // regions, and the answer is the area of those two regions rather than of four rectangles.
    const distinct: TextBox[] = Array.from({ length: 8 }, (_, i) => ({ x: 0, y: i * 50, width: 400, height: 10 }));
    const doubled = distinct.flatMap((b) => [b, { ...b }]);
    // 16 boxes → quartile of 4 → the two lowest lines, each present twice → 2 × 400 × 10 px.
    expect(unionArea(doubled.slice(0, 4), W, H)).toBe(8_000);
    expect(smallTextBandCoverage(doubled, W, H)).toBeCloseTo(0.008, 12);
  });

  it("⚠ still moves when an engine reports every box twice — the residual, measured", () => {
    // Recorded rather than hidden. The quartile is selected by COUNT (`max(1, n/4)`), so doubling
    // the boxes doubles how many are selected, and the selection reaches further down the page even
    // though the union no longer double-counts. The plan's Step 3.3 defines the metric as "union of
    // the smallest-quartile boxes over document area", and this is a property of that definition,
    // not a bug in this implementation — but Step 5.2 derives a floor from recorded values, and it
    // needs to know the quantity is still sensitive to OCR verbosity. Measured here so the number is
    // in the repository rather than in somebody's head: 0.008 → 0.012, where the OLD metric went
    // 0.02 → 0.05. Better by roughly a factor of three, and not immune.
    const lines = (n: number): TextBox[] =>
      Array.from({ length: n }, (_, i) => ({ x: 0, y: i * 12, width: 400, height: 10 }));
    expect(smallTextBandCoverage(lines(10), W, H)).toBeCloseTo(0.008, 12);
    expect(smallTextBandCoverage([...lines(10), ...lines(10)], W, H)).toBeCloseTo(0.012, 12);

    const legacy = (boxes: TextBox[]) => {
      const sorted = boxes.map((b) => b.height).sort((a, b) => a - b);
      return sorted.slice(0, Math.max(1, Math.floor(sorted.length / 4))).reduce((a, b) => a + b, 0) / H;
    };
    expect(legacy(lines(10))).toBeCloseTo(0.02, 12);
    expect(legacy([...lines(10), ...lines(10)])).toBeCloseTo(0.05, 12);
  });

  it("selects the smallest quartile by height, not the largest and not everything", () => {
    // Four boxes of the same area but different heights: the selected one must be the flattest.
    const boxes: TextBox[] = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 200, y: 0, width: 200, height: 50 },
      { x: 0, y: 200, width: 400, height: 25 },
      { x: 0, y: 400, width: 500, height: 20 },
    ];
    // n = 4 → floor(4/4) = 1 box, the 500x20 one → 10,000 px of a 1,000,000 px page.
    expect(smallTextBandCoverage(boxes, W, H)).toBeCloseTo(0.01, 12);
  });

  it("always selects at least one box, even for a single box", () => {
    // floor(1/4) is 0, and a quartile of nothing would report a page with text on it as having none.
    expect(smallTextBandCoverage([{ x: 0, y: 0, width: 100, height: 100 }], W, H)).toBeCloseTo(0.01, 12);
  });

  it("breaks height ties by geometry, so all three languages select the same boxes", () => {
    // With every height equal the comparator has nothing else to go on, and the three languages do
    // not promise the same answer for a tie: V8's and Kotlin's sorts are stable, Swift's is NOT.
    // Ordering by y, then x, then width makes the selection a property of the boxes.
    //
    // ⚠ MEASURED, so nobody over-trusts this case: removing the tie-break does NOT fail it, because
    // V8 is stable and the two orderings coincide here. What catches the removal is the
    // `equal-heights` case in the committed baseline, and the reversal assertions in the Swift and
    // Kotlin suites, where the sort genuinely differs. This test pins the intent; the baseline is
    // what enforces it across the ports.
    const boxes: TextBox[] = Array.from({ length: 8 }, (_, i) => ({ x: i * 100, y: 0, width: 50, height: 30 }));
    const reversed = [...boxes].reverse();
    expect(smallTextBandCoverage(reversed, W, H)).toBe(smallTextBandCoverage(boxes, W, H));
  });
});

describe("the F7 baseline the native ports are held to", () => {
  it("still matches what the reference computes for every case", () => {
    for (const c of baseline.cases) {
      expect(unionArea(c.boxes, W, H), `${c.name} unionAreaPx`).toBeCloseTo(c.unionAreaPx, 6);
      expect(textCoverageFraction(c.boxes, W, H), `${c.name} textCoverageFraction`)
        .toBeCloseTo(c.textCoverageFraction, baseline.tolerance.decimals - 1);
      expect(smallTextBandCoverage(c.boxes, W, H), `${c.name} smallTextBandCoverage`)
        .toBeCloseTo(c.smallTextBandCoverage, baseline.tolerance.decimals - 1);
    }
  });

  it("carries cases that actually discriminate against the implementation F7 replaced", () => {
    // A corpus of cases the old code would also have passed proves nothing about the change. `empty`
    // is the one legitimate exception — both answer 0 — so every other case must disagree with the
    // legacy sum on at least one of the two metrics.
    const agreeing = baseline.cases.filter(
      (c) => c.textCoverageFraction === c.legacy.sumFraction && c.smallTextBandCoverage === c.legacy.smallBand,
    );
    expect(agreeing.map((c) => c.name)).toEqual(["empty"]);
  });

  it("records a version, so a native suite pinned to older arithmetic fails loudly", () => {
    expect(baseline.textCoverageVersion).toMatch(/^scanner-textcoverage-\d+$/);
  });
});
