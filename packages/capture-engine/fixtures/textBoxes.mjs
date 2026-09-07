#!/usr/bin/env node
/**
 * The F7 parity baseline: what the box-union definition answers for a set of hand-built cases
 * (SCANNER-UPGRADE-PLAN.md Step 3.3, audit defect F7, D-SCAN9).
 *
 * ── WHY A SECOND FIXTURE FILE ─────────────────────────────────────────────────────────────────
 * `expected.json` holds what `metrics.ts` answers for 24 PNGs. It cannot hold this: `textCoverage.ts`
 * consumes OCR OUTPUT, not pixels, and no synthetic PNG produces OCR output without an OCR engine —
 * which is a device, not a fixture. So the input here is the boxes themselves, chosen by hand to
 * separate the ways a rectangle-union can be got wrong, and the expected values are computed by the
 * reference exactly as `expected.mjs` does.
 *
 * Every case names the mistake it exists to catch. A case that would still pass against the SUMMING
 * implementation F7 replaced is not worth committing, so each one is checked against that too — the
 * `sumFraction` field records what the old code would have answered, and a case where the two agree
 * is a case that proves nothing about the change.
 *
 * ── HOW TO REGENERATE ─────────────────────────────────────────────────────────────────────────
 *   node fixtures/textBoxes.mjs
 *
 * ⚠ Regenerating is a DEFINITION CHANGE. Every number here is what the Swift and Kotlin ports are
 * held to. If it moves, say in the commit which behaviour changed and why.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { smallTextBandCoverage, textCoverageFraction, unionArea } from "../src/textCoverage.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));

/** A page-sized frame for every case, so the fractions are comparable across them. */
const WIDTH = 1000;
const HEIGHT = 1000;

const CASES = [
  {
    name: "empty",
    why: "No recognised text at all. Must be 0 and must not divide by zero.",
    boxes: [],
  },
  {
    name: "single-box",
    why: "The trivial case, where union and sum agree — a control, so a broken union is not mistaken for a broken harness.",
    boxes: [{ x: 100, y: 100, width: 200, height: 100 }],
  },
  {
    name: "disjoint-pair",
    why: "Two boxes that share no area. Union equals sum here too; it separates 'unions correctly' from 'always returns one box'.",
    boxes: [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 500, y: 500, width: 100, height: 100 },
    ],
  },
  {
    name: "half-overlap",
    why: "THE case. Two equal boxes overlapping by half: the sum counts the shared quarter twice, the union once.",
    boxes: [
      { x: 100, y: 100, width: 200, height: 200 },
      { x: 200, y: 200, width: 200, height: 200 },
    ],
  },
  {
    name: "nested",
    why: "A box entirely inside another — what happens when an engine reports a line and the word within it. The sum double-counts the whole inner box; the union ignores it.",
    boxes: [
      { x: 100, y: 100, width: 400, height: 400 },
      { x: 200, y: 200, width: 100, height: 100 },
    ],
  },
  {
    name: "duplicates",
    why: "The same box four times. The sum reports four times the truth; the union is unmoved. This is the shape that let the old fraction exceed 1.",
    boxes: [
      { x: 0, y: 0, width: 500, height: 500 },
      { x: 0, y: 0, width: 500, height: 500 },
      { x: 0, y: 0, width: 500, height: 500 },
      { x: 0, y: 0, width: 500, height: 500 },
    ],
  },
  {
    name: "touching-edges",
    why: "Two boxes sharing an edge and nothing else. A union that counts the shared edge, or that merges them into a bounding box, both answer wrongly here.",
    boxes: [
      { x: 100, y: 100, width: 100, height: 100 },
      { x: 200, y: 100, width: 100, height: 100 },
    ],
  },
  {
    name: "out-of-frame",
    why: "Boxes that hang off every side, which real OCR emits. Without clipping the coverage exceeds 1 — the same failure by a different route.",
    boxes: [
      { x: -200, y: -200, width: 400, height: 400 },
      { x: 900, y: 900, width: 400, height: 400 },
      { x: 400, y: -50, width: 100, height: 100 },
    ],
  },
  {
    name: "degenerate",
    why: "Zero-width, zero-height, and negative-size boxes. Each must contribute nothing rather than crashing or contributing a negative area.",
    boxes: [
      { x: 100, y: 100, width: 0, height: 200 },
      { x: 200, y: 200, width: 200, height: 0 },
      { x: 300, y: 300, width: -50, height: -50 },
      { x: 400, y: 400, width: 100, height: 100 },
    ],
  },
  {
    name: "fine-print-page",
    why: "A realistic page: eight tall heading lines and twenty-four short fine-print lines. The quartile selection must land on the fine print, and the OLD metric — a sum of heights over the image height — must disagree.",
    boxes: [
      ...Array.from({ length: 8 }, (_, i) => ({ x: 80, y: 80 + i * 60, width: 840, height: 40 })),
      ...Array.from({ length: 24 }, (_, i) => ({ x: 80, y: 600 + i * 15, width: 500, height: 10 })),
    ],
  },
  {
    name: "fine-print-page-doubled",
    why: "The same page with every fine-print line reported TWICE, as an engine that emits a line box and a paragraph box would. The old sum grows; a true coverage fraction must not move at all.",
    boxes: [
      ...Array.from({ length: 8 }, (_, i) => ({ x: 80, y: 80 + i * 60, width: 840, height: 40 })),
      ...Array.from({ length: 24 }, (_, i) => ({ x: 80, y: 600 + i * 15, width: 500, height: 10 })),
      ...Array.from({ length: 24 }, (_, i) => ({ x: 80, y: 600 + i * 15, width: 500, height: 10 })),
    ],
  },
  {
    name: "equal-heights",
    why: "Twelve boxes of IDENTICAL height, so the quartile cut has nothing to break the tie with but the geometry. Pins that all three languages select the same three boxes rather than leaving it to their sort's stability.",
    boxes: Array.from({ length: 12 }, (_, i) => ({ x: (i % 4) * 200, y: Math.floor(i / 4) * 200, width: 150, height: 50 })),
  },
];

/**
 * What the implementation F7 REPLACED would have answered. Recorded so a reviewer can see, per case,
 * whether it discriminates at all — and so the TypeScript suite can assert that the interesting ones
 * do. It is not a thing any shipping code computes; it exists only to make the change visible.
 */
function legacySumFraction(boxes, width, height) {
  const area = width * height;
  return area > 0 ? boxes.reduce((sum, b) => sum + Math.max(0, b.width) * Math.max(0, b.height), 0) / area : 0;
}

/** The old `Σ(line heights) / imageHeight`, for the same reason. */
function legacySmallBand(boxes, height) {
  if (boxes.length === 0 || height <= 0) return 0;
  const sorted = [...boxes].map((b) => b.height).sort((a, b) => a - b);
  const smallest = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 4)));
  return smallest.reduce((a, b) => a + b, 0) / height;
}

export function computeTextBoxBaseline() {
  return {
    // Bumped when the DEFINITION changes, so a native suite pinned to older arithmetic fails loudly.
    textCoverageVersion: "scanner-textcoverage-1",
    width: WIDTH,
    height: HEIGHT,
    /**
     * Absolute, because every value here is a fraction in 0..1 — there is no four-orders-of-magnitude
     * spread to justify a relative bound as blur has. 1e-9 rather than a rounding-shaped number
     * because the arithmetic is exact: all inputs are integers and a union of integer rectangles is
     * an integer, so the only error possible is the division at the end.
     */
    tolerance: { fractionAbsolute: 1e-9, decimals: 9 },
    cases: CASES.map((c) => ({
      name: c.name,
      why: c.why,
      boxes: c.boxes,
      unionAreaPx: unionArea(c.boxes, WIDTH, HEIGHT),
      textCoverageFraction: round(textCoverageFraction(c.boxes, WIDTH, HEIGHT), 9),
      smallTextBandCoverage: round(smallTextBandCoverage(c.boxes, WIDTH, HEIGHT), 9),
      legacy: {
        sumFraction: round(legacySumFraction(c.boxes, WIDTH, HEIGHT), 9),
        smallBand: round(legacySmallBand(c.boxes, HEIGHT), 9),
      },
    })),
  };
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

if (process.argv[1] && process.argv[1].endsWith("textBoxes.mjs")) {
  const baseline = computeTextBoxBaseline();
  const json = JSON.stringify(baseline, null, 2) + "\n";
  writeFileSync(HERE + "textBoxes.json", json);
  const digest = createHash("sha256").update(json).digest("hex").slice(0, 12);
  console.log(`✓ wrote textBoxes.json — ${baseline.cases.length} cases, ${baseline.textCoverageVersion}, sha256:${digest}`);
  for (const c of baseline.cases) {
    const discriminates = c.textCoverageFraction !== c.legacy.sumFraction || c.smallTextBandCoverage !== c.legacy.smallBand;
    console.log(`  ${discriminates ? "≠" : "="} ${c.name.padEnd(28)} union ${c.textCoverageFraction}  vs legacy sum ${c.legacy.sumFraction}`);
  }
}
