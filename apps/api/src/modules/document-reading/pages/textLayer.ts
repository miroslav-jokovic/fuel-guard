import type { TextLayer, TextWord } from "./canonical.js";

/**
 * A born-digital PDF's text runs → words boxed as fractions of the rendered page (D-DR3).
 *
 * Pure, so it is testable without pdf.js. The inputs are pdf.js's own `getTextContent()` items and
 * the page viewport's transform, in pdf.js's conventions:
 *   - `transform` is the run's text matrix in PDF user space (y up, origin bottom-left), with the
 *     font size folded in — so text-space unit 1 is one em;
 *   - `width` is the run's advance in user-space units along that matrix's x axis;
 *   - `ascent` / `descent` are the font's, in em (descent negative), from `textContent.styles`;
 *   - the viewport transform maps user space to the raster (y down, origin top-left), and already
 *     contains the page's `/Rotate` — which is why a rotated page's words come out in reading
 *     orientation without any rotation handling here.
 *
 * ── WORD BOXES ARE APPORTIONED BY GLYPH WIDTH ────────────────────────────────────────────────
 * pdf.js reports one box per RUN (usually a whole line), not per word. A word's box is the run's box
 * cut at the word's share of the run's advance, and the share is weighed with the font's own glyph
 * widths (`glyphWidth`, read from the page's operator list — the document's fonts, not a table of
 * ours). Kerning, character and word spacing are not modelled, so an inner word can sit a fraction
 * of a glyph off; it is never used to decide a CHARACTER — the text itself is exact. Cutting by
 * character COUNT instead was measured on the fixtures at up to 0.68 em off (the "3" in
 * "GASOLINE 3 PG II"), which is why widths are used when the operator list has them.
 */

export interface TextRun {
  str: string;
  /** [a, b, c, d, e, f] — the run's text matrix in user space. */
  transform: readonly number[];
  width: number;
  ascent: number;
  descent: number;
  /** A character's advance in this run's font (any unit — only ratios are used), when known. */
  glyphWidth?: (char: string) => number | undefined;
}

export interface PageGeometry {
  /** The viewport's user-space → raster transform. */
  transform: readonly number[];
  width: number;
  height: number;
}

type Matrix = readonly number[];
type Point = readonly [number, number];

function multiply(m: Matrix, n: Matrix): number[] {
  return [
    m[0]! * n[0]! + m[2]! * n[1]!,
    m[1]! * n[0]! + m[3]! * n[1]!,
    m[0]! * n[2]! + m[2]! * n[3]!,
    m[1]! * n[2]! + m[3]! * n[3]!,
    m[0]! * n[4]! + m[2]! * n[5]! + m[4]!,
    m[1]! * n[4]! + m[3]! * n[5]! + m[5]!,
  ];
}

function apply(m: Matrix, [x, y]: Point): Point {
  return [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Six decimals: sub-pixel at any page size we render, and stable text in the jsonb column. */
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

function boxOf(corners: Point[], page: PageGeometry): TextWord["bbox"] {
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x0 = clamp01(Math.min(...xs) / page.width);
  const y0 = clamp01(Math.min(...ys) / page.height);
  const x1 = clamp01(Math.max(...xs) / page.width);
  const y1 = clamp01(Math.max(...ys) / page.height);
  return { x: round6(x0), y: round6(y0), w: round6(x1 - x0), h: round6(y1 - y0) };
}

/** The words of one run: split on whitespace, each boxed by its share of the run's advance. */
export function wordsOfRun(run: TextRun, page: PageGeometry): TextWord[] {
  const chars = [...run.str];
  if (chars.length === 0) return [];
  // The run's length in text space (em): its user-space advance over the matrix's x-axis scale.
  const scale = Math.hypot(run.transform[0]!, run.transform[1]!);
  if (scale === 0) return [];
  const runEm = run.width / scale;
  const toRaster = multiply(page.transform, run.transform);
  // Cumulative advance before each character, in the font's units; an unknown glyph counts as the
  // run's mean known glyph, or 1 when none is known (which degrades to cutting by character count).
  const known = chars.map((c) => run.glyphWidth?.(c)).filter((w): w is number => w !== undefined && w > 0);
  const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const before = [0];
  for (const c of chars) before.push(before.at(-1)! + (run.glyphWidth?.(c) || fallback));
  const total = before.at(-1)!;
  const words: TextWord[] = [];
  const rx = /\S+/gu;
  for (let m = rx.exec(run.str); m !== null; m = rx.exec(run.str)) {
    const start = [...run.str.slice(0, m.index)].length;
    const end = start + [...m[0]].length;
    const x0 = (runEm * before[start]!) / total;
    const x1 = (runEm * before[end]!) / total;
    const local: Point[] = [
      [x0, run.descent],
      [x1, run.descent],
      [x0, run.ascent],
      [x1, run.ascent],
    ];
    words.push({ text: m[0], bbox: boxOf(local.map((c) => apply(toRaster, c)), page) });
  }
  return words;
}

/** A page's text layer, or null when it carries no words (a scanned page: D-DR3 "gets none"). */
export function textLayerOf(runs: readonly TextRun[], page: PageGeometry): TextLayer | null {
  const words = runs.flatMap((run) => wordsOfRun(run, page));
  return words.length === 0 ? null : { words };
}
