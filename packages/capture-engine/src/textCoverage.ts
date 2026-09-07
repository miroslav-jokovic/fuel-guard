/**
 * How much of the page is text, and how much of it is FINE PRINT — the definition of record
 * (SCANNER-UPGRADE-PLAN.md Step 3.3, audit defect F7, D-SCAN8).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT F7 WAS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Two OCR-derived numbers reached the §5 gate, and neither measured what its name said.
 *
 *   `textCoverageFraction` SUMMED every recognised box's area over the page area. Boxes overlap —
 *   ML Kit reports a line and Vision reports a line, but both engines emit boxes that touch and
 *   sometimes nest — so the "fraction" was free to exceed 1, and did so more often the denser the
 *   paperwork. A floor of 0.08 against a quantity that grows with redundancy is a floor that gets
 *   easier to clear the more confused the OCR is.
 *
 *   `smallTextBandCoverage` was `Σ(line heights) / imageHeight` — a sum of HEIGHTS over a HEIGHT.
 *   It is not a coverage fraction and it is not a fraction of anything: add more lines of the same
 *   size and it grows without bound, so a page of forty tiny lines scored higher than a page of ten,
 *   which is precisely backwards from "does the fine print survive?". Its 0.02 floor was inert on
 *   dense pages and unreachable on sparse ones, which is two failures wearing one number.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THEY ARE NOW
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Both are the UNION of a set of boxes divided by the page area. A union counts each square pixel
 * once however many boxes claim it, so both are genuinely in 0..1 and both mean the thing their name
 * says. `smallTextBandCoverage` takes the union of the smallest-height quartile, so it answers "how
 * much of this page is fine print", which is the question the gate was always trying to ask.
 *
 * ⚠ Both floors are `null` until Step 5.2 derives them from a measured distribution (D-SCAN10). The
 * old 0.08 and 0.02 were calibrated — insofar as they were calibrated at all — against the
 * quantities described above, and carrying a number across a change of definition is the most
 * expensive kind of mistake, because it looks like continuity.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS TYPESCRIPT AND THE NATIVES TRANSLITERATE IT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Same reason as `metrics.ts` (D-SCAN8): a rectangle-union is exactly the kind of small geometric
 * algorithm two people write two different ways without either being obviously wrong. So there is
 * ONE definition here, `fixtures/textBoxes.json` records what it answers for a set of hand-built
 * cases, and the Swift and Kotlin ports are held to that file the way `CaptureMetrics` is held to
 * `expected.json`. Every loop below is written to be transliterated rather than to be clever.
 */

/**
 * One recognised text box in PIXELS, top-left origin.
 *
 * Pixels rather than the normalised 0..1 both OS engines happen to use, because the two normalise
 * against different things — Vision's `boundingBox` is normalised with a BOTTOM-left origin, ML Kit's
 * `Rect` is already in pixels — and a definition that accepted "whatever the platform calls a box"
 * would be measuring the platform. Each port converts at its own boundary, which is the one place
 * that conversion is visible.
 */
export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Area covered by at least one box, in square pixels, clipped to `0..width` × `0..height`.
 *
 * ── THE ALGORITHM, AND WHY THIS ONE ───────────────────────────────────────────────────────────
 * Coordinate compression: collect every distinct x edge and every distinct y edge, which carves the
 * page into a grid of cells whose interiors are each either wholly inside some box or wholly
 * outside; then add up the cells that are covered. It is O(n²) in the number of boxes and a page of
 * paperwork yields tens of them, not thousands — a sweep line with an interval tree would be faster
 * and would not survive being written three times in three languages, which is the property that
 * actually matters here.
 *
 * Clipping happens per box, before the edges are collected: OCR boxes routinely poke a pixel or two
 * outside the frame, and a union that counted those would report a coverage above 1 for the same
 * reason the summing version did.
 */
export function unionArea(boxes: readonly TextBox[], width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;

  const clipped: TextBox[] = [];
  for (const b of boxes) {
    const x0 = Math.max(0, Math.min(width, b.x));
    const y0 = Math.max(0, Math.min(height, b.y));
    const x1 = Math.max(0, Math.min(width, b.x + b.width));
    const y1 = Math.max(0, Math.min(height, b.y + b.height));
    // A box that is entirely outside, or has collapsed to a line, contributes no area. Dropping it
    // here rather than letting it through as a zero-width rectangle keeps the edge lists short and,
    // more importantly, keeps the grid free of degenerate columns that contribute nothing but exist.
    if (x1 > x0 && y1 > y0) clipped.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  if (clipped.length === 0) return 0;

  const xs = sortedDistinct(clipped.flatMap((b) => [b.x, b.x + b.width]));
  const ys = sortedDistinct(clipped.flatMap((b) => [b.y, b.y + b.height]));

  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const cellX0 = xs[i]!;
    const cellX1 = xs[i + 1]!;
    for (let j = 0; j + 1 < ys.length; j++) {
      const cellY0 = ys[j]!;
      const cellY1 = ys[j + 1]!;
      // The cell's midpoint decides membership. Testing a POINT rather than comparing edges is what
      // makes touching boxes and nested boxes both behave: a midpoint is inside exactly one region
      // of the compressed grid, so no cell is ever counted twice and no shared edge is ever counted
      // at all (it has zero width).
      const midX = (cellX0 + cellX1) / 2;
      const midY = (cellY0 + cellY1) / 2;
      for (const b of clipped) {
        if (midX > b.x && midX < b.x + b.width && midY > b.y && midY < b.y + b.height) {
          area += (cellX1 - cellX0) * (cellY1 - cellY0);
          break;
        }
      }
    }
  }
  return area;
}

/** Fraction of the page covered by at least one recognised box, 0..1 (F7). */
export function textCoverageFraction(boxes: readonly TextBox[], width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;
  return unionArea(boxes, width, height) / (width * height);
}

/**
 * Fraction of the page covered by the SMALLEST-height quartile of boxes, 0..1 (F7).
 *
 * The quartile selection is unchanged from the shipped code — sort by height ascending, take
 * `max(1, n/4)` — because that part was never the defect; what it did with the selection was. Keeping
 * the selection identical means a recorded `smallTextBandCoverage` from before and after this change
 * describes the same POPULATION of boxes, so Step 5.2 can compare them if it wants to.
 */
export function smallTextBandCoverage(boxes: readonly TextBox[], width: number, height: number): number {
  if (boxes.length === 0 || width <= 0 || height <= 0) return 0;
  // Sorted by height, then by the geometry, so that boxes of equal height order identically in all
  // three languages. A comparator that returns 0 for ties leaves the order to the sort's stability,
  // and "is this sort stable" is a different answer in JavaScript, Swift and Kotlin.
  const byHeight = [...boxes].sort(
    (a, b) => a.height - b.height || a.y - b.y || a.x - b.x || a.width - b.width,
  );
  const smallest = byHeight.slice(0, Math.max(1, Math.floor(byHeight.length / 4)));
  return unionArea(smallest, width, height) / (width * height);
}

function sortedDistinct(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  }
  return out;
}
